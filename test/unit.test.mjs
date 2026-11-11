/**
 * Offline unit tests for dsh-ugreen-nas: endpoint normalization, the protobuf
 * wire codec, capability bookkeeping and the argument guards in tools.js.
 * No NAS connection needed; run via `npm test`.
 */
import { normalizeEndpoint, unwrapOpenCLIResult } from '../lib/opencli.js'
import { encodeMessage, decodeMessage } from '../lib/protobuf.js'
import { Capabilities } from '../lib/capabilities.js'
import { TOOLS } from '../lib/tools.js'
import { normalizeAllowedRoots, isPathAllowed } from '../lib/paths.js'

// gateway.js imports an optional DSH peer that is not installed in npm-only CI.
// Keep the gateway test meaningful locally and skip it in a bare runner.
let UgreenGateway
try {
  ({ UgreenGateway } = await import('../lib/gateway.js'))
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
}

let passed = 0
let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) { passed++; console.log('  ✓', label) }
  else { failed++; console.error('  ✗', label, detail) }
}
const throws = async (fn, marker = '') => {
  try { await fn(); return false }
  catch (error) { return String(error?.message ?? error).includes(marker) }
}

console.log('dsh-ugreen-nas unit tests')

// --- normalizeEndpoint ---
check('bare IP gets :9443', normalizeEndpoint('192.168.1.10') === 'https://192.168.1.10:9443')
check('IP with port kept', normalizeEndpoint('192.168.1.10:5000') === 'https://192.168.1.10:5000')
check('hostname gets plain https', normalizeEndpoint('nas.example.com') === 'https://nas.example.com')
check('trailing slash stripped', normalizeEndpoint('https://nas.example.com/') === 'https://nas.example.com')
check('protocol-relative host kept', normalizeEndpoint('//nas.example.com') === 'https://nas.example.com')
check('bad scheme rejected', await throws(() => normalizeEndpoint('htp://nas.example.com'), 'NAS 地址格式不正确'))

// --- OpenCLI result unwrap / directory whitelist ---
check('unwraps OpenCLI {value,raw,headers}', unwrapOpenCLIResult({ value: { ok: 1 }, raw: Buffer.from([1]) }).ok === 1)
check('passes through plain values', unwrapOpenCLIResult({ ok: 2 }).ok === 2)
check('normalizes roots from multiline text', normalizeAllowedRoots('/volume1/a,/volume1/b\n/volume1/c/').join() === '/volume1/a,/volume1/b,/volume1/c')
check('root prefix boundary respected', isPathAllowed('/volume1/ab', ['/volume1/a']) === false && isPathAllowed('/volume1/a/b', ['/volume1/a']) === true)
check('empty whitelist allows all', isPathAllowed('/anywhere', []) === true)
check('relative path rejected by whitelist', isPathAllowed('relative/path', ['/volume1']) === false)

// --- protobuf round-trip ---
const catalog = {
  enums: { 'demo.Color': ['RED', 'GREEN'] },
  messages: {
    'demo.Inner': { fields: [
      { name: 'name', number: 1, type: 'STRING' },
      { name: 'size', number: 2, type: 'INT64' },
    ] },
    'demo.Outer': { fields: [
      { name: 'flag', number: 1, type: 'BOOL' },
      { name: 'color', number: 2, type: 'ENUM', typeName: '.demo.Color' },
      { name: 'tags', number: 3, type: 'STRING', repeated: true },
      { name: 'inner', number: 4, type: 'MESSAGE', typeName: '.demo.Inner' },
      { name: 'meta', number: 5, type: 'MESSAGE', typeName: '.demo.MetaEntry', repeated: true },
      { name: 'big', number: 6, type: 'INT64' },
    ] },
    'demo.MetaEntry': { mapEntry: true, fields: [
      { name: 'key', number: 1, type: 'STRING' },
      { name: 'value', number: 2, type: 'STRING' },
    ] },
  },
}
const round = decodeMessage(catalog, 'demo.Outer', encodeMessage(catalog, 'demo.Outer', {
  flag: true, color: 'GREEN', tags: ['a', 'b'], inner: { name: 'x', size: 42 },
  meta: { k1: 'v1', k2: 'v2' }, big: '9007199254740993',
}))
check('bool round-trip', round.flag === true)
check('enum round-trip by name', round.color === 'GREEN')
check('repeated string round-trip', round.tags.join() === 'a,b' && round.tags.length === 2)
check('nested message round-trip', round.inner?.name === 'x' && Number(round.inner?.size) === 42)
check('map round-trip', round.meta?.k1 === 'v1' && round.meta?.k2 === 'v2')
check('int64 beyond safe range stays string', round.big === '9007199254740993')

// --- capabilities ---
{
  let probes = 0
  const caps = new Capabilities({
    configured: () => true,
    probe: async (p) => {
      probes++
      if (p.service === 'storage.Storage') { const e = new Error('denied'); e.status = 403; throw e }
      if (p.service === 'ctlserv.Internal') { const e = new Error('nope'); e.status = 401; throw e }
    },
  })
  const snap = await caps.refresh()
  check('403 probe marked denied', snap.groups.storage === 'denied')
  check('401 probe marks auth invalid', snap.auth === 'invalid' && snap.groups.ctl === 'unknown')
  check('other groups granted', Object.values(snap.groups).filter((s) => s === 'granted').length === 6, JSON.stringify(snap.groups))
  const before = probes
  await caps.refresh()
  check('fresh cache skips re-probe', probes === before)
  await caps.refresh({ force: true })
  check('forced refresh re-probes', probes === before * 2)
  check('isReady denies denied group', caps.isReady('storage') === false && caps.isReady('app') === true)
}

// --- tools argument handling ---
const makeMock = (handler) => {
  const calls = []
  const call = async (group, service, method, request) => {
    calls.push({ group, service, method, request })
    return handler ? handler({ call: calls[calls.length - 1], index: calls.length }) : {}
  }
  call.stream = async (group, service, method, request) => {
    calls.push({ group, service, method, request })
    return handler ? handler({ call: calls[calls.length - 1], index: calls.length }) : []
  }
  return { calls, call }
}
const tool = (name) => TOOLS.find((t) => t.name === name)

{
  const { calls, call } = makeMock()
  await tool('ugreen_app_install').run({ ids: 'com.demo.app' }, call)
  check('app install uses InstallStream', calls[0].method === 'InstallStream')
  check('single-string ids wrapped', calls[0].request.ids.join() === 'com.demo.app' && calls[0].request.ids.length === 1)
}
{
  const { calls, call } = makeMock()
  await tool('ugreen_download_pause').run({ taskIds: 7 }, call)
  check('single-number taskIds wrapped', calls[0].request.task_ids.join() === '7' && calls[0].request.task_ids.length === 1)
}
{
  const { calls, call } = makeMock()
  await tool('ugreen_app_install').run({ ids: ['a', 'b'] }, call)
  check('array ids preserved', calls[0].request.ids.join() === 'a,b' && calls[0].request.ids.length === 2)
}
{
  const { call } = makeMock()
  check('quota set without quotaGb rejected', await throws(() => tool('ugreen_file_quota_set').run({ path: '/x' }, call), 'quotaGb'))
  check('quota set needs execute permission', tool('ugreen_file_quota_set').permission === 'filemgr_set_quota')
}
{
  const { call } = makeMock()
  check('chtimes without timestamps rejected', await throws(() => tool('ugreen_file_chtimes').run({ path: '/x' }, call), 'atime'))
}
{
  const { call } = makeMock()
  check('port check without port rejected', await throws(() => tool('ugreen_docker_check').run({ check: 'port' }, call), '端口号'))
  check('dir check without dir rejected', await throws(() => tool('ugreen_docker_check').run({ check: 'dir' }, call), '目录路径'))
}
{
  const chunk = Buffer.alloc(1048576, 65).toString('base64')
  const { calls, call } = makeMock(() => ({ data: chunk, eof: false }))
  const message = await tool('ugreen_file_write').run({ path: '/big', content: 'x', mode: 'append' }, call).then(() => '', (error) => error.message)
  check('append beyond 8MB rejected', message.includes('8MB'), message)
  check('append guard never writes', !calls.some((c) => c.method === 'WriteFile'))
}
{
  const { calls, call } = makeMock(({ call: c }) => {
    if (c.method === 'ReadFile') { const e = new Error('not found'); e.status = 404; throw e }
    return {}
  })
  await tool('ugreen_file_write').run({ path: '/new', content: 'hi', mode: 'append' }, call)
  const write = calls.find((c) => c.method === 'WriteFile')
  check('append to missing file writes fresh content', Boolean(write) && write.request.total_size === 2)
}
{
  const { calls, call } = makeMock(({ call: c }) => {
    if (c.method === 'ReadFile') return { data: Buffer.from('AAAA').toString('base64'), eof: true, bytes_read: 4 }
    return {}
  })
  await tool('ugreen_file_write').run({ path: '/existing', content: 'BBBB', mode: 'append' }, call)
  const write = calls.find((c) => c.method === 'WriteFile')
  check('append preserves existing content', Boolean(write) && Buffer.from(write.request.content, 'base64').toString() === 'AAAABBBB')
}
{
  const { calls, call } = makeMock(({ call: c }) => {
    if (c.method === 'ReadFile') { const e = new Error('denied'); e.status = 403; throw e }
    return {}
  })
  const surfaced = await tool('ugreen_file_write').run({ path: '/denied', content: 'x', mode: 'append' }, call).then(() => false, (error) => error.status === 403)
  check('append read failure surfaces instead of overwriting', surfaced && !calls.some((c) => c.method === 'WriteFile'))
}
{
  const { call } = makeMock(() => ({ data: Buffer.from('ok' + String.fromCharCode(0) + 'bad').toString('base64'), eof: true, bytes_read: 7 }))
  const out = JSON.parse(await tool('ugreen_file_read').run({ path: '/f' }, call))
  check('nul byte forces base64 branch', Boolean(out.base64) && out.text === undefined)
}
{
  const { call } = makeMock(() => ({ data: Buffer.from('中文 ok' + String.fromCharCode(10)).toString('base64'), eof: true, bytes_read: 10 }))
  const out = JSON.parse(await tool('ugreen_file_read').run({ path: '/f' }, call))
  check('utf8 text stays printable', out.text === '中文 ok' + String.fromCharCode(10))
}

{
  const { call } = makeMock(() => ({ data: Buffer.from('hello').toString('base64'), eof: true, bytes_read: 5 }))
  const out = JSON.parse(await tool('ugreen_file_read').run({ path: '/f' }, call))
  check('file read returns decoded content', out.text === 'hello' && out.bytesRead === 5)
}
{
  const { call } = makeMock(() => ({
    data: { file_list: { top_path: '/volume1', total: 1, files: [{ name: 'a.txt', path: '/volume1/a.txt' }] } },
  }))
  const out = JSON.parse(await tool('ugreen_file_list').run({ path: '/volume1' }, call))
  check('file list returns entries', out.entries.length === 1 && out.topPath === '/volume1')
}
{
  const { call } = makeMock()
  call.allowedRoots = ['/volume1/work']
  call.guardPath = (value, label) => { if (!isPathAllowed(value, call.allowedRoots)) throw new Error(label + ' outside whitelist') }
  check('file read rejects path outside whitelist', await throws(() => tool('ugreen_file_read').run({ path: '/volume1/private/x' }, call), 'outside whitelist'))
  check('file read allows path inside whitelist', await tool('ugreen_file_read').run({ path: '/volume1/work/x' }, call).then(() => true, () => false))
}

// --- settings gateway: save and unbind ---
if (UgreenGateway) {
  let settings = {
    endpoint: 'https://nas.example.com',
    accessToken: 'test-token',
    timeoutMs: 15000,
    rejectUnauthorized: false,
    mode: 'full',
    accessLevel: 'admin',
    confirmMode: 'ask',
    allowedRoots: [],
  }
  const gateway = Object.create(UgreenGateway.prototype)
  gateway.owner = {
    getSettings: () => ({ ...settings, hasToken: () => Boolean(settings.accessToken) }),
    update: async (patch) => { settings = { ...settings, ...patch } },
  }
  const saved = await gateway.save('https://nas.example.com', '', 15000, false, 'full', ['/volume1/work'], 'ask', 'user')
  check('gateway saves whitelist and role', saved.allowedRoots.join() === '/volume1/work' && saved.accessLevel === 'user' && saved.confirmMode === 'ask')
  await gateway.unbind()
  check('gateway unbind clears token and endpoint', settings.accessToken === '' && settings.endpoint === '')
} else {
  console.log('  (dsh-typert-protocol unavailable; gateway test skipped)')
}
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
