/**
 * Host-side Remote gateway for the browser settings page.
 *
 * The browser half (lib/client.js) talks to these methods through the /api
 * connection RPC channel — the same authenticated path dsh-vaultwarden uses —
 * under the wire namespace `ug`: connection.rpc.call('/api', 'ug/<method>',
 * { args }). The plugin serves no HTTP route of its own.
 *
 * Method parameters must be plain identifiers: the gateway's source-mode
 * validation rejects defaults, destructuring and rest parameters.
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { normalizeEndpoint } from './opencli.js'

/** Attach one Remote marker to a prototype method without decorator syntax. */
function markRemote(prototype, method, exportName = method) {
  Remote(exportName)(prototype[method], {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    addInitializer(initializer) {
      initializer.call(Object.create(prototype))
    },
  })
}

export class UgreenGateway extends TypertRemoteService {
  /**
   * @param {object} ctx cordis context
   * @param {{ owner: { getSettings: () => object, update: (patch: object) => Promise<object> }, clientFactory: () => object, catalog: object, capabilities: object }} config
   */
  constructor(ctx, config) {
    super(ctx, 'ug')
    this.owner = config.owner
    this.clientFactory = config.clientFactory
    this.catalog = config.catalog
    // Field name must not collide with the capabilities() remote method below —
    // a same-named instance field shadows the prototype method and the RPC
    // dispatcher then sees a plain object instead of the callable.
    this.caps = config.capabilities
  }

  /** Current settings view. The access token is never returned, only its presence. */
  status() {
    const settings = this.owner.getSettings()
    return {
      configured: Boolean(settings.endpoint && settings.hasToken()),
      endpoint: settings.endpoint || '',
      hasToken: settings.hasToken(),
      mode: settings.mode || 'full',
      timeoutMs: settings.timeoutMs,
      rejectUnauthorized: settings.rejectUnauthorized,
    }
  }

  /** Per-group capability snapshot; probes only when the cache is stale, so
   *  reopening the page never re-fires the 8 group probes. */
  async capabilities() {
    try { await this.caps.refresh() } catch { /* snapshot still answers */ }
    return this.caps.snapshot()
  }

  /**
   * Persist settings through the host settings service. An empty accessToken
   * keeps the stored one, so the page never needs the secret back.
   */
  async save(endpoint, accessToken, timeoutMs, rejectUnauthorized, mode) {
    const cleanEndpoint = String(endpoint ?? '').trim()
    // 落盘前先校验地址格式：坏地址一旦持久化，插件下次激活会直接失败，设置页也随之不可达。
    if (cleanEndpoint) normalizeEndpoint(cleanEndpoint)
    const seconds = Math.round(Number(timeoutMs) || 0)
    const patch = {
      endpoint: cleanEndpoint,
      timeoutMs: seconds >= 1000 ? seconds : 15000,
      rejectUnauthorized: Boolean(rejectUnauthorized),
    }
    if (mode === 'readonly' || mode === 'full') patch.mode = mode
    const token = String(accessToken ?? '').trim()
    if (token) patch.accessToken = token
    await this.owner.update(patch)
    return this.status()
  }

  /** Run one OpenCLI call with the current settings; returns app statuses. */
  async test() {
    const client = this.clientFactory()
    const catalog = this.catalog
    const result = await client.call({
      socketId: 'ugreen.app.grpc',
      service: 'app.App',
      method: 'GetAppStatus',
      request: { ids: ['com.ugreen.appmgr', 'com.ugreen.filemgr'] },
      catalog,
    })
    return { ok: true, apps: result.value }
  }
}

markRemote(UgreenGateway.prototype, 'status')
markRemote(UgreenGateway.prototype, 'capabilities')
markRemote(UgreenGateway.prototype, 'save')
markRemote(UgreenGateway.prototype, 'test')