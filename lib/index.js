/**
 * dsh-ugreen-nas — UGREEN NAS OpenCLI connector for DSH.
 *
 * Host half. Registers read-only tools against the NAS's public OpenCLI API.
 * Configuration is a normal DSH plugin Config schema (settings page).
 *
 * The service/method/schema catalog is generated from the UGOS application
 * binaries; see docs/ugreen-opencli-protocol.md for the extraction procedure.
 */
import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { OpenCLIClient, OpenCLIError } from './opencli.js'
import { UgreenGateway } from './gateway.js'

export const name = 'dsh-ugreen-nas'
export const inject = ['tools']

const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'))

const SOCKET = {
  app: 'ugreen.app.grpc',
  files: 'ugreen.filemgr.internal.grpc',
  storage: 'ugreen.storage.grpc',
  tasks: 'ugreen.taskmgr.internal.grpc',
  docker: 'ugreen.dockerserv.internal.grpc',
  downloads: 'ugreen.downloadserv.internal.grpc',
}

const readConfigValue = (value) => {
  if (value && typeof value === 'object' && typeof value.get === 'function') {
    try { return value.get() } catch { return undefined }
  }
  return value
}

const resolveSettings = (source = {}) => {
  const value = source || {}
  const field = (key) => readConfigValue(value[key])
  return {
    endpoint: String(field('endpoint') || '').trim(),
    accessToken: String(field('accessToken') || '').trim(),
    timeoutMs: Number.isFinite(Number(field('timeoutMs'))) && Number(field('timeoutMs')) >= 1000 ? Number(field('timeoutMs')) : 15000,
    rejectUnauthorized: field('rejectUnauthorized') === undefined ? false : Boolean(field('rejectUnauthorized')),
  }
}

const text = (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
const failure = (error) => {
  if (error instanceof OpenCLIError) {
    const suffix = error.requestId ? `（request_id: ${error.requestId}）` : ''
    return `绿联 NAS 操作失败：${error.message}${suffix}`
  }
  return `绿联 NAS 操作失败：${error?.message ?? error}`
}

const compact = (value) => JSON.stringify(value, null, 2)

const makeClient = (settings) => new OpenCLIClient({
  endpoint: settings.endpoint,
  token: settings.accessToken,
  timeoutMs: settings.timeoutMs,
  rejectUnauthorized: settings.rejectUnauthorized,
})

export const Config = z.object({
  endpoint: z.string().default('').volatile().description('NAS 地址：IP、UGREENlink ID、DDNS 或完整 URL；裸 IP 默认加 https://:9443'),
  accessToken: z.string().role('secret').default('').volatile().description('访问令牌（ugpoa_v1...），只在设置页保存，不进入对话'),
  timeoutMs: z.natural().default(15000).volatile().description('单次 OpenCLI 请求超时（毫秒）'),
  rejectUnauthorized: z.boolean().default(false).volatile().description('是否校验 HTTPS 证书；NAS 自签证书保持 false'),
})

export function apply(ctx, config = {}) {
  let settings = resolveSettings(config)
  let client = makeClient(settings)
  const call = (socketId, service, method, request) => client.call({ socketId, service, method, request, catalog })

  // Settings-page bridge: the browser half reads/writes config through the
  // 'ug' Remote gateway (lib/gateway.js) over the /api RPC channel, because
  // this host build does not hand plugins.bundle.config a form object.
  let settingsService = null
  ctx.inject(['settings'], (sctx) => { settingsService = sctx.settings })
  ctx.plugin(UgreenGateway, {
    owner: {
      getSettings: () => settings,
      update: async (patch) => {
        if (!settingsService || typeof settingsService.update !== 'function') {
          throw new OpenCLIError('宿主设置服务不可用，请重启 DSH 后重试', { code: 'no_settings_service' })
        }
        await settingsService.update('dsh-ugreen-nas', patch)
        settings = resolveSettings({ ...settings, ...patch })
        client = makeClient(settings)
      },
    },
    clientFactory: () => makeClient(settings),
    catalog,
  })

  // The host auto-renders Config as the plugin settings form. Tools below are
  // read-only: no mutation methods are registered in this first version.
  const tools = [
    {
      name: 'ugreen_connection_test',
      description: '测试绿联 NAS 访问令牌与 OpenCLI 连接；返回指定应用的运行状态。首次配置或排错时先调用。',
      parameters: {
        appIds: { type: 'array', items: { type: 'string' }, description: '应用 ID 列表，默认 ["com.ugreen.appmgr"]' },
      },
      async execute(args) {
        try {
          const ids = Array.isArray(args.appIds) && args.appIds.length ? args.appIds : ['com.ugreen.appmgr']
          const result = await call(SOCKET.app, 'app.App', 'GetAppStatus', { ids })
          return compact({ ok: true, endpoint: settings.endpoint, apps: result.status || result })
        } catch (error) { return failure(error) }
      },
    },
    {
      name: 'ugreen_file_stat',
      description: '读取绿联 NAS 上文件或文件夹的属性（大小、类型、权限、时间戳）。只读。',
      parameters: {
        path: { type: 'string', required: true, description: '绝对路径，例如 /volume1/demo' },
      },
      async execute(args) {
        try {
          const result = await call(SOCKET.files, 'ugidl.filesystem.Filesystem', 'Stat', { path: String(args.path) })
          return compact(result.stat || result)
        } catch (error) { return failure(error) }
      },
    },
    {
      name: 'ugreen_file_list',
      description: '列出绿联 NAS 文件夹内容；支持按路径或根目录类型浏览，返回名称、路径、大小、类型与修改时间。只读。',
      parameters: {
        path: { type: 'string', description: '绝对路径，例如 /home/<user>；为空时用 rootType 选择根目录' },
        rootType: { type: 'integer', description: '根目录类型：1 收藏、2 个人文件夹、3 共享文件夹、4 用户文件夹、5 网络文件夹、6 外部设备、7 镜像、8 分享目录、9 标签；默认 2' },
        limit: { type: 'integer', description: '返回条数上限，0 表示不限' },
        page: { type: 'integer', description: '页码，默认 1' },
      },
      async execute(args) {
        try {
          const request = {
            path: String(args.path || ''),
            root_type: Number(args.rootType) || (args.path ? 0 : 2),
            limit: Number(args.limit) || 0,
            page: Math.max(Number(args.page) || 1, 1),
          }
          const result = await call(SOCKET.files, 'ugidl.filesystem.Filesystem', 'CategoryOrFileDirList', request)
          const data = result.data || result
          const list = data.file_list || data.fileList || data
          return compact({
            topPath: list.top_path ?? list.topPath,
            total: list.total,
            entries: list.files || list.entries || [],
          })
        } catch (error) { return failure(error) }
      },
    },
    {
      name: 'ugreen_file_read',
      description: '读取绿联 NAS 上的小文件内容；默认最多读取 256KB，文本直接返回，二进制返回 base64。只读。',
      parameters: {
        path: { type: 'string', required: true, description: '绝对路径' },
        offset: { type: 'integer', description: '字节偏移，默认 0' },
        length: { type: 'integer', description: '读取字节数，默认 262144，最大 1048576' },
      },
      async execute(args) {
        try {
          const length = Math.min(Math.max(Number(args.length) || 262144, 1), 1048576)
          const result = await call(SOCKET.files, 'ugidl.filesystem.Filesystem', 'ReadFile', {
            path: String(args.path),
            offset: Number(args.offset) || 0,
            length,
            is_dry_run: false,
          })
          const data = result.data ? Buffer.from(result.data, 'base64') : Buffer.alloc(0)
          const view = data.toString('utf8')
          const printable = !view.includes('\u0000') && [...view].every((ch) => ch === '\n' || ch === '\r' || ch === '\t' || ch.charCodeAt(0) >= 32)
          return compact({
            path: args.path,
            bytesRead: result.bytes_read ?? data.length,
            eof: result.eof ?? undefined,
            ...(printable ? { text: view } : { base64: result.data || '' }),
          })
        } catch (error) { return failure(error) }
      },
    },
    {
      name: 'ugreen_storage_info',
      description: '查询绿联 NAS 的磁盘、存储池与卷信息。只读。',
      parameters: {},
      async execute() {
        try {
          const [disks, pools, volumes] = await Promise.all([
            call(SOCKET.storage, 'storage.Storage', 'DiskList', { value: '' }),
            call(SOCKET.storage, 'storage.Storage', 'PoolList', {}),
            call(SOCKET.storage, 'storage.Storage', 'VolumeList', {}),
          ])
          return compact({ disks: disks.list || disks, pools: pools.pool_list || pools, volumes: volumes.volumes || volumes })
        } catch (error) { return failure(error) }
      },
    },
    {
      name: 'ugreen_task_overview',
      description: '查询绿联 NAS 任务管理器的运行总览：CPU、内存、GPU、风扇、网络和磁盘速率。只读。',
      parameters: {},
      async execute() {
        try {
          return compact(await call(SOCKET.tasks, 'taskserv.TaskManage', 'GetRunOverview', {}))
        } catch (error) { return failure(error) }
      },
    },
    {
      name: 'ugreen_docker_list',
      description: '列出绿联 NAS 上的 Docker 容器（名称、镜像、状态、CPU/内存占用）。只读。',
      parameters: {
        name: { type: 'string', description: '按容器名过滤，可选' },
        page: { type: 'integer', description: '页码，默认 1' },
        pageSize: { type: 'integer', description: '每页数量，默认 50，最大 200' },
      },
      async execute(args) {
        try {
          const result = await call(SOCKET.docker, 'docker.Docker', 'ContainerList', {
            container_name: String(args.name || ''),
            page_num: Math.max(Number(args.page) || 1, 1),
            page_size: Math.min(Math.max(Number(args.pageSize) || 50, 1), 200),
          })
          return compact(result.result || result)
        } catch (error) { return failure(error) }
      },
    },
    {
      name: 'ugreen_docker_logs',
      description: '读取绿联 NAS 上指定 Docker 容器最近日志。只读。',
      parameters: {
        containerId: { type: 'string', required: true, description: '容器 ID（可从 ugreen_docker_list 获取）' },
        raw: { type: 'boolean', description: '是否返回原始日志，默认 false' },
      },
      async execute(args) {
        try {
          const result = await call(SOCKET.docker, 'docker.Docker', 'GetContainerLogs', {
            container_id: String(args.containerId),
            raw_data: Boolean(args.raw),
          })
          return compact(result)
        } catch (error) { return failure(error) }
      },
    },
    {
      name: 'ugreen_download_list',
      description: '查询绿联 NAS 下载中心的任务列表与状态。只读。',
      parameters: {},
      async execute() {
        try {
          const result = await call(SOCKET.downloads, 'download.DownloadService', 'BatchGetDownloadTask', { task_ids: [] })
          return compact(result.tasks || result)
        } catch (error) { return failure(error) }
      },
    },
  ]

  for (const tool of tools) {
    ctx.effect(
      () => ctx.tools.register(defineTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        output: { schema: { type: 'string' }, render: text },
        execute: tool.execute,
      })),
      `dsh-ugreen-nas: ${tool.name}`,
    )
  }
}

export default { name, inject, Config, apply }