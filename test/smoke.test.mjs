/**
 * Smoke test: imports the host entry the way DSH does, runs apply() against a
 * fake context, and exercises the read-only tools against a live NAS when
 * UGREEN_TOKEN (or /tmp/.nas_opencli_token) is available.
 */
import { readFileSync, existsSync } from 'node:fs'
import { name, inject, Config, apply } from '../lib/index.js'

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
const fakeCtx = {
  effect: (fn, label) => { effects.push(label); return fn() },
  tools: { register: (tool) => { tools.push(tool); return () => {} } },
  inject: () => undefined,
}
apply(fakeCtx, { endpoint: ref(endpoint), accessToken: ref(token), timeoutMs: ref(15000), rejectUnauthorized: ref(false) })

console.log('dsh-ugreen-nas smoke test')
check('plugin name', name === 'dsh-ugreen-nas')
check('inject tools', inject.includes('tools'))
check('config schema', Boolean(Config))
check('registers read-only tools', ['ugreen_connection_test','ugreen_file_stat','ugreen_file_list','ugreen_file_read','ugreen_storage_info','ugreen_task_overview','ugreen_docker_list','ugreen_docker_logs','ugreen_download_list'].every(n => tools.some(t => t.name === n)), tools.map(t => t.name).join(','))
check('effects labelled', effects.length === tools.length && effects.every(x => x.startsWith('dsh-ugreen-nas:')))

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