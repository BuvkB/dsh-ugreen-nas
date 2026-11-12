/**
 * UGREEN NAS OpenCLI HTTP client.
 *
 * The public OpenCLI endpoint is:
 *   {endpoint}/ugreen/opencli/v1/{socket_id}/{full_method}
 *
 * Where full_method is the gRPC method path without its leading slash, e.g.
 * app.App/GetAppStatus. The request body is raw protobuf (not JSON), and the
 * access token is accepted only in the Authorization header.
 */
import http from 'node:http'
import https from 'node:https'
import { lookup as dnsLookup } from 'node:dns/promises'
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { encodeMessage, decodeMessage, methodSchema } from './protobuf.js'

const USER_AGENT = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return `dsh-ugreen-nas/${pkg.version || '0.0.0'}`
  } catch { return 'dsh-ugreen-nas' }
})()

/** Frame types used by the OpenCLI WebSocket streaming protocol. */
const STREAM_FRAME = { DATA: 0x01, HALF_CLOSE: 0x02, CANCEL: 0x03, STATUS: 0x13 }

/** UGREENlink ID → device relay hostname lookup (same API the official portal uses). */
const UGREENLINK_LOOKUP_URL = 'https://api.ugnas.com/api/p2p/v2/ta/nodeInfo/byAlias'
const UGREENLINK_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})$/i
const MAX_REDIRECTS = 5
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

const isIPv4 = (host) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
const isIPv6 = (host) => /^\[[0-9a-f:.]+\]$/i.test(host)
const isIpHost = (host) => isIPv4(host) || isIPv6(host)
const badEndpoint = () => new OpenCLIError('NAS 地址格式不正确，支持 IP、UGREENlink ID / 短链、DDNS 或完整 URL', { code: 'bad_endpoint' })

/** Decode the compact status payload attached to an OpenCLI stream error frame. */
function decodeStreamStatus(payload) {
  const catalog = {
    messages: {
      'opencli.StreamStatus': {
        fields: [
          { name: 'code', number: 1, type: 'INT32' },
          { name: 'message', number: 2, type: 'STRING' },
        ],
      },
    },
    enums: {},
  }
  try { return decodeMessage(catalog, 'opencli.StreamStatus', payload) } catch { return {} }
}

export const unwrapOpenCLIResult = (result) => (
  result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'value')
    ? result.value
    : result
)

export class OpenCLIError extends Error {
  constructor(message, { code = 'opencli_error', status, requestId, cause } = {}) {
    super(message)
    this.name = 'OpenCLIError'
    this.code = code
    this.status = status
    this.requestId = requestId
    if (cause) this.cause = cause
  }
}

export function normalizeEndpoint(input) {
  let value = String(input || '').trim()
  if (!value) return ''
  const hadScheme = /^https?:\/\//i.test(value)
  if (value.startsWith('//')) value = 'https:' + value
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) throw badEndpoint()
  if (!/^https?:\/\//i.test(value)) {
    // Bare host[:port][/path]: IPv4, bracketed IPv6, hostname or UGREENlink ID.
    if (!/^(?:[a-z0-9._~%!$&'()*+,;=\-]+|\[[0-9a-f:.]+\])(?::\d+)?(?:\/[^\s]*)?$/i.test(value)) {
      throw badEndpoint()
    }
    value = 'https://' + value
  }
  const authority = value.replace(/^https?:\/\//i, '').split('/')[0]
  const hadExplicitPort = /:\d+$/.test(authority)
  let url
  try { url = new URL(value) } catch { throw badEndpoint() }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badEndpoint()
  if (!url.hostname) throw badEndpoint()
  // The UGOS device console listens on 9443. A bare IP (or an https:// IP
  // without an explicit port) is the normal first setup; hostnames stay 443.
  if (isIpHost(url.hostname) && !url.port && !hadExplicitPort && (!hadScheme || url.protocol === 'https:')) url.port = '9443'
  // Users often paste the browser address (…/desktop/?os=ugospro). OpenCLI
  // lives at the site root, so drop the web UI suffix and its query.
  if (/^\/desktop\/?$/i.test(url.pathname)) {
    url.pathname = '/'
    url.search = ''
    url.hash = ''
  }
  return url.toString().replace(/\/+$/, '')
}

/**
 * Detect whether a normalized endpoint is a UGREENlink ID/short link.
 * 'bare'  — a single-label host such as `myNAS123` (may also be a local hostname)
 * 'short' — the official `https://ug.link/<id>` link
 */
export function detectUgreenlinkId(input) {
  let normalized
  try { normalized = normalizeEndpoint(input) } catch { return null }
  if (!normalized) return null
  const url = new URL(normalized)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const path = url.pathname.replace(/\/+$/, '')
  if ((host === 'ug.link' || host === 'www.ug.link') && path) {
    let parts = path.split('/').filter(Boolean)
    if (parts.length === 2 && /^desktop$/i.test(parts[1])) parts = [parts[0]]
    if (parts.length !== 1) return null
    let alias
    try { alias = decodeURIComponent(parts[0]) } catch { return null }
    if (!UGREENLINK_ID_RE.test(alias)) return null
    return { alias, kind: 'short' }
  }
  if (host.includes('.') || host === 'localhost' || isIpHost(host) || url.port || path) return null
  if (!UGREENLINK_ID_RE.test(host)) return null
  return { alias: host, kind: 'bare' }
}

/** Resolve a UGREENlink ID through the official alias API to its relay hostname. */
export async function resolveUgreenlinkId(alias, { timeoutMs = 6000, fetchImpl } = {}) {
  const value = String(alias || '').trim()
  if (!UGREENLINK_ID_RE.test(value)) {
    throw new OpenCLIError('UGREENlink ID 格式不正确：' + (value || '(空)'), { code: 'ugreenlink_bad_id' })
  }
  const doFetch = fetchImpl || globalThis.fetch
  if (typeof doFetch !== 'function') {
    throw new OpenCLIError('当前运行环境不支持联网解析 UGREENlink ID', { code: 'ugreenlink_unavailable' })
  }
  const controller = new AbortController()
  const waitMs = Math.max(Number(timeoutMs) || 6000, 1000)
  const timer = setTimeout(() => controller.abort(), waitMs)
  try {
    const response = await doFetch(UGREENLINK_LOOKUP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Language': 'zh-CN',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ alias: value }),
      signal: controller.signal,
    })
    let payload = null
    try { payload = await response.json() } catch { /* non-JSON error page */ }
    if (!response.ok) {
      throw new OpenCLIError('UGREENlink 解析服务返回 HTTP ' + response.status, { code: 'ugreenlink_http', status: response.status })
    }
    if (Number(payload?.code) === 7022) {
      throw new OpenCLIError('UGREENlink ID 不存在：' + value, { code: 'ugreenlink_not_found', status: response.status })
    }
    if (Number(payload?.code) !== 200 || !payload?.data?.relayDomain) {
      throw new OpenCLIError(payload?.msg || 'UGREENlink ID 解析失败', { code: 'ugreenlink_unresolved', status: response.status })
    }
    const relay = String(payload.data.relayDomain).trim().toLowerCase()
    if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(relay)) {
      throw new OpenCLIError('UGREENlink 解析结果异常：relayDomain=' + payload.data.relayDomain, { code: 'ugreenlink_unresolved' })
    }
    const resolvedAlias = String(payload.data.alias || value).trim().toLowerCase()
    if (!UGREENLINK_ID_RE.test(resolvedAlias)) {
      throw new OpenCLIError('UGREENlink 解析结果异常：alias=' + payload.data.alias, { code: 'ugreenlink_unresolved' })
    }
    return 'https://' + resolvedAlias + '.' + relay
  } catch (error) {
    if (error instanceof OpenCLIError) throw error
    if (error?.name === 'AbortError') {
      throw new OpenCLIError('UGREENlink ID 解析超时（' + waitMs + 'ms）', { code: 'ugreenlink_timeout' })
    }
    throw new OpenCLIError('UGREENlink ID 解析失败：' + (error?.message ?? error), { code: 'ugreenlink_unresolved', cause: error })
  } finally {
    clearTimeout(timer)
  }
}

/** Normalize and, when needed, expand a UGREENlink ID to a direct device host. */
export async function resolveEndpoint(input, options = {}) {
  const normalized = normalizeEndpoint(input)
  if (!normalized) return ''
  const info = detectUgreenlinkId(normalized)
  if (!info) return normalized
  // A bare single-label value may be a LAN hostname. Try local DNS first so
  // names like `nas` keep working; only unresolved names go to UGREENlink.
  if (info.kind === 'bare') {
    const lookup = options.lookupImpl || dnsLookup
    try {
      const result = await lookup(info.alias)
      const found = Array.isArray(result) ? result.length > 0 : Boolean(result && result.address)
      if (found) return normalized
    } catch { /* not resolvable locally — try UGREENlink */ }
  }
  return resolveUgreenlinkId(info.alias, options)
}

export class OpenCLIClient {
  constructor({ endpoint, token, timeoutMs = 15000, rejectUnauthorized = false, fetchImpl, lookupImpl } = {}) {
    this.rawEndpoint = normalizeEndpoint(endpoint)
    this.endpoint = this.rawEndpoint
    this.token = String(token || '').trim()
    this.timeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000
    this.rejectUnauthorized = Boolean(rejectUnauthorized)
    this.fetchImpl = fetchImpl
    this.lookupImpl = lookupImpl
    this.resolvePromise = null
    this.resolved = false
  }

  get configured() { return Boolean(this.endpoint && this.token) }

  /** Resolve a bare UGREENlink ID / short link once, before the first call. */
  async ensureEndpoint() {
    if (!this.rawEndpoint || this.resolved) return this.endpoint
    if (!this.resolvePromise) {
      this.resolvePromise = resolveEndpoint(this.rawEndpoint, {
        timeoutMs: Math.min(this.timeoutMs, 8000),
        fetchImpl: this.fetchImpl,
        lookupImpl: this.lookupImpl,
      }).then((resolved) => {
        this.endpoint = resolved
        this.resolved = true
        return resolved
      }).catch((error) => {
        this.resolvePromise = null
        throw error
      })
    }
    return this.resolvePromise
  }

  async call({ socketId, service, method, request = {}, catalog }) {
    if (!this.configured) throw new OpenCLIError('NAS 地址或访问令牌未配置', { code: 'not_configured' })
    const { inputType, outputType } = methodSchema(catalog, service, method)
    const body = encodeMessage(catalog, inputType, request || {})
    const endpoint = await this.ensureEndpoint()
    const url = new URL(endpoint)
    const fullMethod = `/${service}/${method}`.replace(/^\/+/, '')
    const target = new URL(`${url.pathname.replace(/\/$/, '')}/ugreen/opencli/v1/${encodeURIComponent(socketId)}/${fullMethod}`, url)
    target.search = ''
    target.hash = ''
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/x-protobuf',
      Accept: 'application/x-protobuf',
      'X-OpenCLI-Body-Format': 'protobuf',
      'Content-Length': String(body.length),
      'User-Agent': USER_AGENT,
    }
    const response = await this.request(target, headers, body)
    const grpcCode = response.headers['x-grpc-code']
    if (response.statusCode === 200 && (grpcCode === undefined || grpcCode === '0')) {
      try {
        return { value: decodeMessage(catalog, outputType, response.body), raw: response.body, headers: response.headers }
      } catch (error) {
        throw new OpenCLIError(`OpenCLI 响应解码失败: ${error.message}`, { code: 'decode_failed', status: response.statusCode })
      }
    }
    let parsed
    try { parsed = JSON.parse(response.body.toString('utf8')) } catch { parsed = null }
    const message = parsed?.message || parsed?.code || `OpenCLI HTTP ${response.statusCode}`
    throw new OpenCLIError(message, {
      code: parsed?.code || (grpcCode ? `grpc_${grpcCode}` : 'http_error'),
      status: response.statusCode,
      requestId: parsed?.request_id || response.headers['x-request-id'],
    })
  }

  /**
   * Call a server-streaming OpenCLI method over WebSocket.
   *
   * The protocol is not gRPC-Web: each WebSocket binary message is a one-byte
   * frame type followed by a raw protobuf payload. The client sends one DATA
   * frame with the request and one HALF_CLOSE frame, then receives zero or
   * more DATA frames followed by an empty STATUS frame.
   */
  async callStream({ socketId, service, method, request = {}, catalog, timeoutMs }) {
    if (!this.configured) throw new OpenCLIError('NAS 地址或访问令牌未配置', { code: 'not_configured' })
    const { inputType, outputType } = methodSchema(catalog, service, method)
    const body = encodeMessage(catalog, inputType, request || {})
    const endpoint = await this.ensureEndpoint()
    const url = new URL(endpoint)
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const fullMethod = `${service}/${method}`.replace(/^\/+/, '')
    const wsUrl = `${protocol}//${url.host}${url.pathname.replace(/\/$/, '')}/ugreen/opencli/v1/${encodeURIComponent(socketId)}/${fullMethod}`
    const waitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : this.timeoutMs
    const messages = []
    return new Promise((resolve, reject) => {
      let settled = false
      let timer
      const socket = new WebSocket(wsUrl, ['ugreen.opencli.grpc-stream.v1'], {
        headers: { Authorization: `Bearer ${this.token}` },
        rejectUnauthorized: this.rejectUnauthorized,
        handshakeTimeout: waitMs,
        perMessageDeflate: false,
      })
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { socket.close() } catch { /* already closed */ }
        if (error) reject(error)
        else resolve(messages)
      }
      timer = setTimeout(() => {
        finish(new OpenCLIError(`OpenCLI 流式请求超时（${waitMs}ms）`, { code: 'timeout' }))
      }, waitMs)
      socket.on('open', () => {
        try {
          socket.send(Buffer.concat([Buffer.from([STREAM_FRAME.DATA]), body]))
          socket.send(Buffer.from([STREAM_FRAME.HALF_CLOSE]))
        } catch (error) {
          finish(new OpenCLIError(`OpenCLI 流式请求发送失败: ${error.message}`, { code: 'network' }))
        }
      })
      socket.on('message', (data) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
        if (buffer.length < 1) return
        const type = buffer[0]
        const payload = buffer.subarray(1)
        if (type === STREAM_FRAME.DATA) {
          try {
            messages.push(decodeMessage(catalog, outputType, payload))
          } catch (error) {
            finish(new OpenCLIError(`OpenCLI 流式响应解码失败: ${error.message}`, { code: 'decode_failed' }))
          }
        } else if (type === STREAM_FRAME.STATUS) {
          // 空 STATUS 表示正常结束，立即收尾，不依赖对端的关闭码。
          if (payload.length === 0) { finish(); return }
          const status = decodeStreamStatus(payload)
          finish(new OpenCLIError(status.message || 'OpenCLI 流式调用失败', { code: 'stream_error' }))
        }
      })
      socket.on('error', (error) => {
        finish(new OpenCLIError(`无法连接 NAS 流式接口: ${error.message}`, { code: 'network', cause: error }))
      })
      socket.on('close', (code, reason) => {
        if (settled) return
        if (code === 1000 || code === 1005) finish()
        else finish(new OpenCLIError(`OpenCLI 流式连接中断（${code}${reason?.length ? ': ' + reason.toString() : ''}）`, { code: 'stream_closed' }))
      })
    })
  }

  /** One HTTP request; follows 301/302/303/307/308 up to MAX_REDIRECTS hops. */
  request(target, headers, body, redirects = 0) {
    return new Promise((resolve, reject) => {
      const url = target instanceof URL ? target : new URL(target)
      const lib = url.protocol === 'http:' ? http : https
      const req = lib.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: body === undefined ? 'GET' : 'POST',
        headers,
        rejectUnauthorized: this.rejectUnauthorized,
      }, (res) => {
        const statusCode = res.statusCode || 0
        const location = res.headers?.location
        if (REDIRECT_STATUS.has(statusCode) && location) {
          res.resume()
          if (redirects >= MAX_REDIRECTS) {
            reject(new OpenCLIError(`重定向次数超过 ${MAX_REDIRECTS} 次`, { code: 'too_many_redirects', status: statusCode }))
            return
          }
          let next
          try { next = new URL(location, url) } catch {
            reject(new OpenCLIError(`重定向地址无效：${location}`, { code: 'bad_redirect' }))
            return
          }
          if (next.protocol !== 'http:' && next.protocol !== 'https:') {
            reject(new OpenCLIError(`不支持的重定向协议：${next.protocol}`, { code: 'bad_redirect' }))
            return
          }
          const nextHeaders = { ...headers }
          // Never forward the NAS access token to a different origin/host
          // (hostname + port). Same-host http→https keeps the token.
          if (next.host.toLowerCase() !== url.host.toLowerCase()) {
            delete nextHeaders.Authorization
          }
          const nextBody = statusCode === 303 ? undefined : body
          if (statusCode === 303) nextHeaders['Content-Length'] = '0'
          resolve(this.request(next, nextHeaders, nextBody, redirects + 1))
          return
        }
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      })
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new OpenCLIError(`OpenCLI 请求超时（${this.timeoutMs}ms）`, { code: 'timeout' }))
      })
      req.on('error', (error) => {
        if (error instanceof OpenCLIError) reject(error)
        else reject(new OpenCLIError(`无法连接 NAS: ${error.message}`, { code: 'network', cause: error }))
      })
      req.end(body)
    })
  }
}