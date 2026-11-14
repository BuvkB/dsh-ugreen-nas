/**
 * Smoke test: imports the host entry the way DSH does, runs apply() against a
 * fake context, and exercises the read-only tools against a live NAS when
 * UGREEN_TOKEN (or /tmp/.nas_opencli_token) is available.
 */
import { readFileSync, existsSync } from 'node:fs'
// index.js imports the optional DSH peers. Degrade like unit.test does for the
// gateway when they are not linked (bare checkout) instead of failing the run.
let entry = null
try {
  entry = await import('../lib/index.js')
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
}
if (!entry) {
  console.log('  (DSH peers not linked; run `npm run build` first — smoke skipped)')
  process.exit(0)
}
const { name, inject, Config, apply } = entry

let passed = 0
let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) { passed++; console.log('  ✓', label) }
  else { failed++; console.error('  ✗', label, detail) }
}
const token = process.env.UGREEN_TOKEN || (existsSync('/tmp/.nas_opencli_token') ? readFileSync('/tmp/.nas_opencli_token', 'utf8').trim() : '')
const endpoint = process.env.UGREEN_ENDPOINT || ''
const write = Symbol.for('cosmokit.volatile.write')
const ref = (value) => Object.freeze({ get: () => value, [write]: () => {} })

const tools = []
const effects = []
const plugins = []
const listeners = []
const fakeCtx = {
  effect: (fn, label) => { effects.push(label); return fn() },
  on: (event, handler) => { listeners.push({ event, handler }); return () => {} },
  get: (name) => name === 'approval' ? { effectivePolicy: () => 'never' } : undefined,
  tools: { register: (tool) => { tools.push(tool); return () => {} } },
  plugin: (plugin, config) => { plugins.push({ plugin, config }); return { name: plugin?.name } },
  inject: () => undefined,
}
apply(fakeCtx, { endpoint: ref(endpoint), accessToken: ref(token), timeoutMs: ref(15000), rejectUnauthorized: ref(false) })

console.log('dsh-ugreen-nas smoke test')
check('plugin name', name === 'dsh-ugreen-nas')
check('inject tools', inject.includes('tools'))
check('config schema', Boolean(Config))
check('registers the full tool set', ['ugreen_connection_test','ugreen_app_status','ugreen_app_install','ugreen_app_uninstall','ugreen_app_update','ugreen_app_start','ugreen_app_stop','ugreen_file_stat','ugreen_file_list','ugreen_file_read','ugreen_file_write','ugreen_file_mkdir','ugreen_file_share_mkdir','ugreen_file_rename','ugreen_file_move','ugreen_file_delete','ugreen_file_restore','ugreen_file_chtimes','ugreen_file_tag_set','ugreen_file_tag_link','ugreen_file_tag_list','ugreen_file_quota','ugreen_file_quota_set','ugreen_storage_info','ugreen_task_overview','ugreen_docker_list','ugreen_docker_logs','ugreen_docker_start','ugreen_docker_stop','ugreen_docker_restart','ugreen_docker_compose_list','ugreen_docker_compose_logs','ugreen_docker_compose_create','ugreen_docker_compose_start','ugreen_docker_compose_stop','ugreen_docker_compose_restart','ugreen_docker_compose_delete','ugreen_docker_image_search','ugreen_docker_image_list','ugreen_docker_image_pull','ugreen_docker_app_usage','ugreen_docker_app_rebuild','ugreen_download_list','ugreen_download_create','ugreen_download_pause','ugreen_download_resume','ugreen_download_retry','ugreen_download_remove','ugreen_system_info','ugreen_user_list','ugreen_user_create','ugreen_group_add_members','ugreen_hardware_info','ugreen_network_info','ugreen_search'].every(n => tools.some(t => t.name === n)), tools.map(t => t.name).join(','))
check('registers 60 tools', tools.length === 60, String(tools.length))
check('effects labelled', effects.length === tools.length + 1 && effects.every(x => x.startsWith('dsh-ugreen-nas:')), effects.filter(x => !x.startsWith('dsh-ugreen-nas:')).join(','))
check('registers high-risk approval gate', listeners.some((entry) => entry.event === 'tools/pre-execute'), listeners.map((entry) => entry.event).join(','))
{
  const gate = listeners.find((entry) => entry.event === 'tools/pre-execute')?.handler
  const next = async () => ({ kind: 'allow' })
  check('approval gate asks for delete', gate && (await gate({ name: 'ugreen_file_delete' }, next)).kind === 'ask')
  check('approval gate allows read', gate && (await gate({ name: 'ugreen_file_read' }, next)).kind === 'allow')
  const deleteTool = tools.find((tool) => tool.name === 'ugreen_file_delete')
  const denied = await deleteTool.execute({ path: '/volume1/x' }, { callId: 'call-1', signal: new AbortController().signal, agent: { session: {} } })
  check('host approval never blocks write before NAS', typeof denied === 'string' && denied.includes('操作被拒绝'), String(denied))
}
check('mounts the ug gateway', plugins.length === 1 && plugins[0].plugin?.name === 'UgreenGateway' && typeof plugins[0].config?.clientFactory === 'function', JSON.stringify(plugins.map(p => p.plugin?.name)))

if (!token || !endpoint) {
  console.log('  (UGREEN_TOKEN / UGREEN_ENDPOINT not set; live checks skipped)')
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

const run = async (toolName, args = {}) => {
  const tool = tools.find(t => t.name === toolName)
  return await tool.execute(args, { signal: new AbortController().signal })
}
for (const [toolName, args, marker] of [
  ['ugreen_connection_test', {}, 'ok'],
  ['ugreen_storage_info', {}, 'disks'],
  ['ugreen_task_overview', {}, 'cpu_used_percent'],
  ['ugreen_docker_list', { pageSize: 3 }, 'name'],
  ['ugreen_file_list', { rootType: 2, limit: 5 }, 'entries'],
]) {
  const value = await run(toolName, args)
  check(toolName + ' returns data', typeof value === 'string' && value.includes(marker), String(value).slice(0, 200))
}
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)