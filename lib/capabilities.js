/**
 * Capability probes: what the access token can actually do on this NAS.
 *
 * The NAS does not expose a "list my grants" endpoint to the token itself, so
 * availability is learned by probing one cheap read per app group and
 * classifying the failure. Results cache for CAPABILITY_TTL_MS. Probing is
 * explicit (settings page / test connection); `isReady` never throws and never
 * blocks — it returns the last known state, treating unknown as visible.
 */

const CAPABILITY_TTL_MS = 10 * 60 * 1000

/** One representative call per group: cheapest read that the group's permission gates. */
const PROBES = {
  app: { permission: 'app_detail', socketId: 'ugreen.app.grpc', service: 'app.App', method: 'GetAppStatus', request: { ids: ['com.ugreen.appmgr'] } },
  files: { permission: 'filemgr_list_and_attr', socketId: 'ugreen.filemgr.internal.grpc', service: 'ugidl.filesystem.Filesystem', method: 'CategoryOrFileDirList', request: { root_type: 2, limit: 1 } },
  storage: { permission: 'storage.disk.list', socketId: 'ugreen.storage.grpc', service: 'storage.Storage', method: 'DiskList', request: { value: '' } },
  tasks: { permission: 'taskmgr_get_run_overview', socketId: 'ugreen.taskmgr.internal.grpc', service: 'taskserv.TaskManage', method: 'GetRunOverview', request: {} },
  docker: { permission: 'docker_container_list', socketId: 'ugreen.dockerserv.internal.grpc', service: 'docker.Docker', method: 'ContainerList', request: { page_num: 1, page_size: 1 } },
  downloads: { permission: 'download_task_get', socketId: 'ugreen.downloadserv.internal.grpc', service: 'download.DownloadService', method: 'BatchGetDownloadTask', request: { task_ids: [] } },
  ctl: { permission: 'ctl_os_identity', socketId: 'ugreen.ctlserv.internal.grpc', service: 'ctlserv.Internal', method: 'GetOsIdentity', request: {} },
  search: { permission: 'title_search_task', socketId: 'ugreen.search.grpc', service: 'search.Search', method: 'CancelTitleTask', request: { task_id: '00000000-0000-4000-8000-000000000000' } },
}

export const GROUPS = Object.keys(PROBES)

export class Capabilities {
  /** @param {{ configured: () => boolean, probe: (probe: object) => Promise<{ ok: boolean, error?: { status?: number, code?: string } }> }} deps */
  constructor(deps) {
    this.deps = deps
    this.cache = {} // group -> 'granted' | 'denied' | 'unknown'
    this.authState = 'unknown' // 'ok' | 'invalid' | 'unknown'
    this.refreshedAt = 0
    this.refreshing = null
  }

  snapshot() {
    const groups = {}
    for (const group of GROUPS) groups[group] = this.cache[group] ?? 'unknown'
    return { auth: this.authState, groups, refreshedAt: this.refreshedAt }
  }

  /** Classify one probe outcome. */
  classify(error) {
    const status = error?.status
    const code = String(error?.code ?? '')
    if (status === 401 || code === 'unauthorized') return 'auth'
    if (status === 403 || code === 'grpc_7') return 'denied'
    if (status === 424 || code === 'app_not_available' || code === 'method_not_provided') return 'denied'
    // A 404 from a probe means the call reached the service but the probe's
    // dummy id did not exist; that still proves the permission was granted.
    if (status === 404) return 'ok'
    return 'unknown'
  }

  /** The cache may answer without probing: fresh enough and holding a concrete
   *  result, so a run that only produced `unknown` keeps retrying. */
  fresh() {
    return this.deps.configured()
      && this.refreshedAt > 0
      && Date.now() - this.refreshedAt < CAPABILITY_TTL_MS
      && this.authState !== 'unknown'
  }

  /** Probe all groups once; concurrent callers share one flight unless forced. */
  refresh(options = {}) {
    if (!options.force) {
      if (this.refreshing) return this.refreshing
      if (this.fresh()) return Promise.resolve(this.snapshot())
    }
    const task = this.probeAll().finally(() => {
      if (this.refreshing === task) this.refreshing = null
    })
    this.refreshing = task
    return task
  }

  async probeAll() {
    if (!this.deps.configured()) {
      this.authState = 'unconfigured'
      for (const group of GROUPS) this.cache[group] = 'unknown'
      this.refreshedAt = Date.now()
      return this.snapshot()
    }
    const results = await Promise.all(GROUPS.map(async (group) => {
      try {
        await this.deps.probe(PROBES[group])
        return [group, 'granted']
      } catch (error) {
        const kind = this.classify(error)
        if (kind === 'auth') return [group, 'auth']
        return [group, kind === 'denied' ? 'denied' : kind === 'ok' ? 'granted' : 'unknown']
      }
    }))
    let auth = 'ok'
    let concrete = 0
    for (const [group, state] of results) {
      this.cache[group] = state === 'auth' ? 'unknown' : state
      if (state === 'auth') auth = 'invalid'
      if (state !== 'unknown') concrete++
    }
    // 全部探测都因网络等原因失败时令牌从未被验证过，auth=ok 会把 NAS 误报成已连接。
    if (auth === 'ok' && concrete === 0) auth = 'unknown'
    this.authState = auth
    this.refreshedAt = Date.now()
    return this.snapshot()
  }

  /** Last known availability for one group. Probing is explicit: opening the
   *  settings page (or pressing 重新探测) calls refresh(); plugin activation does
   *  not fire read requests at the NAS on its own. Unknown stays visible so a
   *  permission error can still teach the model which grant is missing. */
  /**
   * 工具级可用性：组探针被拒绝只代表该组的代表读 RPC 不可用，不能据此隐藏
   * 同组中权限完全不同的工具（例如只有 filemgr_upload 的上传令牌不应因
   * CategoryOrFileDirList 403 连 ugreen_file_write 都被隐藏）。
   * 工具声明了权限且不包含组探针权限时，保留工具，让 NAS 的 403 给出精确提示。
   */
  isReady(group, tool) {
    if (!this.deps.configured()) return false
    const state = this.cache[group] ?? 'unknown'
    if (state !== 'denied') return true
    const probePermission = PROBES[group]?.permission
    const toolPerms = Array.isArray(tool?.permissions) && tool.permissions.length
      ? tool.permissions
      : tool?.permission ? [tool.permission] : []
    if (!probePermission || !toolPerms.length) return false
    return toolPerms.some((permission) => permission !== probePermission)
  }
}
