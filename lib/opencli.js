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
  if (value.startsWith('//')) value = value.slice(2)
  if (!/^https?:\/\//i.test(value)) {
    const isBareHost = /^[a-z0-9.-]+(:\d+)?$/i.test(value)
    if (!isBareHost) throw new OpenCLIError('NAS 地址格式不正确，支持 IP、UGREENlink ID、DDNS 或完整 URL', { code: 'bad_endpoint' })
    const hasPort = /:\d+$/.test(value)
    const isIp = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(value)
    // Device console listens on 9443; a bare LAN IP is the normal first setup.
    // UGREENlink/DDNS hostnames normally sit behind 443.
    value = isIp && !hasPort ? `https://${value}:9443` : `https://${value}`
  }
  return value.replace(/\/+$/, '')
}

export class OpenCLIClient {
  constructor({ endpoint, token, timeoutMs = 15000, rejectUnauthorized = false } = {}) {
    this.endpoint = normalizeEndpoint(endpoint)
    this.token = String(token || '').trim()
    this.timeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000
    this.rejectUnauthorized = Boolean(rejectUnauthorized)
  }

  get configured() { return Boolean(this.endpoint && this.token) }

  async call({ socketId, service, method, request = {}, catalog }) {
    if (!this.configured) throw new OpenCLIError('NAS 地址或访问令牌未配置', { code: 'not_configured' })
    const { inputType, outputType } = methodSchema(catalog, service, method)
    const body = encodeMessage(catalog, inputType, request || {})
    const url = new URL(this.endpoint)
    const fullMethod = `/${service}/${method}`.replace(/^\/+/, '')
    const path = `${url.pathname.replace(/\/$/, '')}/ugreen/opencli/v1/${encodeURIComponent(socketId)}/${fullMethod}`
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/x-protobuf',
      Accept: 'application/x-protobuf',
      'X-OpenCLI-Body-Format': 'protobuf',
      'Content-Length': String(body.length),
      'User-Agent': USER_AGENT,
    }
    const response = await this.request(url, path, headers, body)
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
    const url = new URL(this.endpoint)
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

  request(url, path, headers, body) {
    return new Promise((resolve, reject) => {
      const lib = url.protocol === 'http:' ? http : https
      const req = lib.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path,
        method: 'POST',
        headers,
        rejectUnauthorized: this.rejectUnauthorized,
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }))
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