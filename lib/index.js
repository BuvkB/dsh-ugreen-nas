/**
 * dsh-ugreen-nas — UGREEN NAS OpenCLI connector for DSH.
 *
 * Host half. Registers tools covering the NAS access-token permission surface
 * (8 app groups, 70 permissions). Tools are gated twice:
 *   1. `mode` setting: 'readonly' registers read tools only; 'full' registers
 *      everything (default).
 *   2. capability probes: tools whose app group the token cannot use on the
 *      NAS side stay hidden from the model (lib/capabilities.js).
 *
 * The service/method/schema catalog is generated from the UGOS application
 * binaries; see docs/ugreen-opencli-protocol.md for the extraction procedure.
 */
import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { OpenCLIClient, OpenCLIError } from './opencli.js'
import { Capabilities } from './capabilities.js'
import { UgreenGateway } from './gateway.js'
import { TOOLS, isReadOnlyTool } from './tools.js'

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
  ctl: 'ugreen.ctlserv.internal.grpc',
  search: 'ugreen.search.grpc',
}

const READ_ONLY = new Set(TOOLS.filter(isReadOnlyTool).map((t) => t.name))

const readConfigValue = (value) => {
  if (value && typeof value === 'object' && typeof value.get === 'function') {
    try { return value.get() } catch { return undefined }
  }
  return value
}

const resolveSettings = (source = {}) => {
  const value = source || {}
  const field = (key) => readConfigValue(value[key])
  const mode = field('mode') === 'readonly' ? 'readonly' : 'full'
  return {
    endpoint: String(field('endpoint') || '').trim(),
    accessToken: String(field('accessToken') || '').trim(),
    timeoutMs: Number.isFinite(Number(field('timeoutMs'))) && Number(field('timeoutMs')) >= 1000 ? Number(field('timeoutMs')) : 15000,
    rejectUnauthorized: field('rejectUnauthorized') === undefined ? false : Boolean(field('rejectUnauthorized')),
    mode,
  }
}

const asText = (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]

const PERMISSION_HINTS = {
  filemgr_upload: 'filemgr_upload（上传/写文件）',
  filemgr_create_dir: 'filemgr_create_dir（新建文件夹）',
  filemgr_create_share_dir: 'filemgr_create_share_dir（新建共享文件夹）',
  filemgr_rename: 'filemgr_rename（重命名）',
  filemgr_cp_move_path: 'filemgr_cp_move_path（复制/移动）',
  filemgr_delete: 'filemgr_delete（删除文件）',
  filemgr_recover_from_recycle: 'filemgr_recover_from_recycle（回收站恢复）',
  filemgr_chtimes: 'filemgr_chtimes（修改时间戳）',
  filemgr_add_tag: 'filemgr_add_tag（添加标签）',
  filemgr_get_tag: 'filemgr_get_tag（读取标签）',
  filemgr_get_quota: 'filemgr_get_quota（查询配额）',
  filemgr_set_quota: 'filemgr_set_quota（设置配额）',
  app_install_stream: 'app_install_stream（安装应用）',
  app_uninstall_stream: 'app_uninstall_stream（卸载应用）',
  app_update_stream: 'app_update_stream（更新应用）',
  app_start: 'app_start（启动应用）',
  app_stop: 'app_stop（停用应用）',
  title_search_task: 'title_search_task（全局搜索）',
  docker_container_start: 'docker_container_start（启动容器）',
  docker_container_stop: 'docker_container_stop（停止容器）',
  docker_container_restart: 'docker_container_restart（重启容器）',
  docker_compose_project_create: 'docker_compose_project_create（创建 Compose 项目）',
  docker_compose_project_start: 'docker_compose_project_start（启动 Compose 项目）',
  docker_compose_project_stop: 'docker_compose_project_stop（停止 Compose 项目）',
  docker_compose_project_restart: 'docker_compose_project_restart（重启 Compose 项目）',
  docker_compose_project_delete: 'docker_compose_project_delete（删除 Compose 项目）',
  docker_image_search: 'docker_image_search（搜索镜像）',
  docker_image_list: 'docker_image_list（查看本地镜像）',
  docker_image_pull: 'docker_image_pull（拉取镜像）',
  docker_app_usage: 'docker_app_usage（容器应用占用）',
  docker_app_rebuild: 'docker_app_rebuild（重建容器应用）',
  download_task_create: 'download_task_create（创建下载任务）',
  download_task_pause: 'download_task_pause（暂停任务）',
  download_task_resume: 'download_task_resume（恢复任务）',
  download_task_retry_failed: 'download_task_retry_failed（重试任务）',
  download_task_remove: 'download_task_remove（移除任务）',
  ctl_user_create: 'ctl_user_create（创建账号）',
  ctl_group_add_members: 'ctl_group_add_members（用户组成员）',
  ctl_hardware_power: 'ctl_hardware_power（硬件设置）',
  ctl_network_general: 'ctl_network_general（网络配置）',
  ctl_os_identity: 'ctl_os_identity（系统信息）',
  ctl_user_group_list: 'ctl_user_group_list（账号与用户组）',
}

function makeFailure() {
  return (error, tool) => {
    if (error instanceof OpenCLIError) {
      if (error.status === 403 || error.code === 'grpc_7') {
        const grant = tool?.permission ? PERMISSION_HINTS[tool.permission] : ''
        const target = grant ? `需要 NAS 端令牌包含「${grant}」权限` : '需要 NAS 端令牌包含对应权限'
        return `绿联 NAS 拒绝访问（${error.message}）。${target}：请在 NAS 控制面板重建访问令牌并勾选该能力。`
      }
      if (error.code === 'not_configured') {
        return '绿联 NAS 未配置：请在 DSH 设置 → 插件 → dsh-ugreen-nas 填写 NAS 地址与访问令牌。'
      }
      const suffix = error.requestId ? `（request_id: ${error.requestId}）` : ''
      return `绿联 NAS 操作失败：${error.message}${suffix}`
    }
    return `绿联 NAS 操作失败：${error?.message ?? error}`
  }
}

const makeClient = (settings) => new OpenCLIClient({
  endpoint: settings.endpoint,
  token: settings.accessToken,
  timeoutMs: settings.timeoutMs,
  rejectUnauthorized: settings.rejectUnauthorized,
})

export const Config = z.object({
  endpoint: z.string().default('').volatile().description('NAS 地址：IP、UGREENlink ID、DDNS 或完整 URL；裸 IP 默认加 https://:9443'),
  accessToken: z.string().role('secret').default('').volatile().description('访问令牌（ugpoa_v1...），只在设置页保存，不进入对话'),
  mode: z.union([z.const('full'), z.const('readonly')]).default('full').volatile().description('full=按令牌权限注册全部工具（含写/删/执行）；readonly=仅注册只读工具'),
  timeoutMs: z.natural().default(15000).volatile().description('单次 OpenCLI 请求超时（毫秒）'),
  rejectUnauthorized: z.boolean().default(false).volatile().description('是否校验 HTTPS 证书；NAS 自签证书保持 false'),
})

export function apply(ctx, config = {}) {
  let settings = resolveSettings(config)
  let client = makeClient(settings)
  const call = (group, service, method, request) => client.call({ socketId: SOCKET[group], service, method, request, catalog })
  call.stream = (group, service, method, request, options = {}) => client.callStream({
    socketId: SOCKET[group], service, method, request, catalog, ...options,
  })

  const capabilities = new Capabilities({
    configured: () => Boolean(settings.endpoint && settings.accessToken),
    probe: (probe) => client.call({ ...probe, catalog }),
  })

  // Settings-page bridge: the browser half reads/writes config through the
  // 'ug' Remote gateway (lib/gateway.js) over the /api RPC channel.
  let settingsService = null
  ctx.inject(['settings'], (sctx) => { settingsService = sctx.settings })
  ctx.plugin(UgreenGateway, {
    owner: {
      getSettings: () => ({ ...settings, hasToken: () => Boolean(settings.accessToken) }),
      update: async (patch) => {
        if (!settingsService || typeof settingsService.update !== 'function') {
          throw new OpenCLIError('宿主设置服务不可用，请重启 DSH 后重试', { code: 'no_settings_service' })
        }
        await settingsService.update('dsh-ugreen-nas', patch)
        settings = resolveSettings({ ...settings, ...patch })
        client = makeClient(settings)
        await capabilities.refresh().catch(() => {})
        return capabilities.snapshot()
      },
    },
    clientFactory: () => makeClient(settings),
    catalog,
    capabilities,
  })

  // Warm the first capability probe once configured so `when` gating has data.
  if (settings.endpoint && settings.accessToken) capabilities.refresh().catch(() => {})

  const failure = makeFailure()
  for (const tool of TOOLS) {
    const isReadOnly = READ_ONLY.has(tool.name)
    ctx.effect(
      () => ctx.tools.register(defineTool({
        name: tool.name,
        description: tool.destructive ? `${tool.description}【写/危险操作】` : tool.description,
        parameters: tool.parameters,
        output: { schema: { type: 'string' }, render: asText },
        async execute(args) {
          try {
            return await tool.run(args, call)
          } catch (error) {
            return failure(error, tool)
          }
        },
      }), {
        when: () => {
          if (settings.mode === 'readonly' && !isReadOnly) return false
          if (!settings.endpoint || !settings.accessToken) return false
          return capabilities.isReady(tool.group)
        },
      }),
      `dsh-ugreen-nas: ${tool.name}`,
    )
  }
}

export default { name, inject, Config, apply }