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
import { OpenCLIClient, OpenCLIError, normalizeEndpoint, unwrapOpenCLIResult } from './opencli.js'
import { Capabilities } from './capabilities.js'
import { UgreenGateway } from './gateway.js'
import { TOOLS, PERMISSION_OPERATION, isReadOnlyTool } from './tools.js'
import { assertPathAllowed, normalizeAllowedRoots } from './paths.js'

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

/** App groups a normal NAS account must not see (article: admin-only modules). */
const ADMIN_GROUPS = new Set(['app', 'storage', 'tasks', 'docker', 'ctl'])

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
  let allowedRoots = []
  try {
    allowedRoots = normalizeAllowedRoots(field('allowedRoots'))
  } catch {
    // A bad persisted whitelist must not prevent the plugin from loading; the
    // settings page can fix it. Empty means "no extra restriction".
    allowedRoots = []
  }
  return {
    endpoint: String(field('endpoint') || '').trim(),
    accessToken: String(field('accessToken') || '').trim(),
    timeoutMs: Number.isFinite(Number(field('timeoutMs'))) && Number(field('timeoutMs')) >= 1000 ? Number(field('timeoutMs')) : 15000,
    rejectUnauthorized: field('rejectUnauthorized') === undefined ? false : Boolean(field('rejectUnauthorized')),
    mode,
    allowedRoots,
    confirmMode: field('confirmMode') === 'off' ? 'off' : 'ask',
    accessLevel: field('accessLevel') === 'user' ? 'user' : 'admin',
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
  ctl_os_update_status: 'ctl_os_update_status（系统更新状态）',
  ctl_network_connection: 'ctl_network_connection（网卡状态）',
  filemgr_list_and_attr: 'filemgr_list_and_attr（浏览文件列表与属性）',
  filemgr_read_and_download: 'filemgr_read_and_download（读取与下载文件）',
  filemgr_delete_tag: 'filemgr_delete_tag（删除标签）',
  app_detail: 'app_detail（应用详情与运行状态）',
  app_search_and_available_updates: 'app_search_and_available_updates（应用搜索与更新检查）',
  'storage.disk.list': 'storage.disk.list（查看磁盘列表）',
  'storage.pool.list': 'storage.pool.list（查看存储池）',
  'storage.volume.list': 'storage.volume.list（查看卷列表）',
  'storage.disk.smart.all': 'storage.disk.smart.all（S.M.A.R.T. 诊断）',
  taskmgr_get_run_overview: 'taskmgr_get_run_overview（任务总览）',
  taskmgr_get_cpu_metric: 'taskmgr_get_cpu_metric（CPU 指标）',
  taskmgr_get_gpu_metric: 'taskmgr_get_gpu_metric（GPU 指标）',
  taskmgr_get_mem_metric: 'taskmgr_get_mem_metric（内存指标）',
  taskmgr_get_net_traffic: 'taskmgr_get_net_traffic（网络速率）',
  taskmgr_get_disk_metric: 'taskmgr_get_disk_metric（磁盘速率）',
  taskmgr_get_volume_metric: 'taskmgr_get_volume_metric（卷速率）',
  taskmgr_get_service_resource: 'taskmgr_get_service_resource（服务占用）',
  taskmgr_get_process_resource: 'taskmgr_get_process_resource（进程占用）',
  docker_container_list: 'docker_container_list（查看容器）',
  docker_container_logs: 'docker_container_logs（容器日志）',
  docker_compose_project_list: 'docker_compose_project_list（查看 Compose 项目）',
  docker_compose_project_logs: 'docker_compose_project_logs（Compose 项目日志）',
  docker_app_discrete_gpu_check: 'docker_app_discrete_gpu_check（独显占用检查）',
  docker_container_port_check: 'docker_container_port_check（端口占用检查）',
  docker_container_directory_check: 'docker_container_directory_check（目录占用检查）',
  download_task_get: 'download_task_get（查看下载任务）',
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
  endpoint: z.string().default('').volatile().description('NAS 地址：IP、UGREENlink ID / 短链、DDNS 或完整 URL；裸 IP 默认加 https://:9443，UGREENlink ID 自动解析为设备域名'),
  accessToken: z.string().role('secret').default('').volatile().description('访问令牌（ugpoa_v1...），只在设置页保存，不进入对话'),
  mode: z.union([z.const('full'), z.const('readonly')]).default('full').volatile().description('full=按令牌权限注册全部工具（含写/删/执行）；readonly=仅注册只读工具'),
  accessLevel: z.union([z.const('admin'), z.const('user')]).default('admin').volatile().description('当前访问令牌所属账号角色：admin=全部工具；user=仅文件、下载、全局搜索等非系统类工具'),
  confirmMode: z.union([z.const('ask'), z.const('off')]).default('ask').volatile().description('写/删/执行类操作是否经 DSH 审批；ask=每次确认（受宿主 approval 策略约束；完全权限档会直接拒绝），off=直接执行（不推荐）'),
  allowedRoots: z.array(z.string()).default([]).volatile().description('文件目录白名单（绝对路径数组）；留空=不额外限制。设置页按行编辑'),
  timeoutMs: z.natural().default(15000).volatile().description('单次 OpenCLI 请求超时（毫秒）'),
  rejectUnauthorized: z.boolean().default(false).volatile().description('是否校验 HTTPS 证书；NAS 自签证书保持 false'),
})

export function apply(ctx, config = {}) {
  let settings = resolveSettings(config)
  // 配置里可能残留格式非法的 endpoint；降级为未配置继续激活，设置页才能打开修正，
  // 否则坏地址会让插件加载失败、页面不可达。
  let client
  try {
    client = makeClient(settings)
  } catch (error) {
    client = new OpenCLIClient({})
    settings = { ...settings, endpoint: '' }
    console.warn('dsh-ugreen-nas: endpoint 配置无效，已按未配置处理：', error?.message)
  }
  // `OpenCLIClient.call` returns `{ value, raw, headers }`; tools operate on
  // the decoded protobuf message only. Keeping the raw buffer in every tool
  // result used to leak megabytes of byte arrays into the model context.
  const call = async (group, service, method, request) => unwrapOpenCLIResult(
    await client.call({ socketId: SOCKET[group], service, method, request, catalog }),
  )
  call.stream = (group, service, method, request, options = {}) => client.callStream({
    socketId: SOCKET[group], service, method, request, catalog, ...options,
  })
  call.guardPath = (value, label = '路径') => assertPathAllowed(value, settings.allowedRoots, label)
  Object.defineProperty(call, 'allowedRoots', { get: () => settings.allowedRoots })

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
        const merged = resolveSettings({ ...settings, ...patch })
        if (merged.endpoint) merged.endpoint = normalizeEndpoint(merged.endpoint)
        const nextPatch = patch.endpoint === undefined ? patch : { ...patch, endpoint: merged.endpoint }
        await settingsService.update('dsh-ugreen-nas', nextPatch)
        settings = merged
        client = makeClient(settings)
        await capabilities.refresh({ force: true }).catch(() => {})
        return capabilities.snapshot()
      },
    },
    clientFactory: () => makeClient(settings),
    catalog,
    capabilities,
  })

  // No capability probe on plugin activation: opening the NAS connection must
  // not read directories or system information before the user asks for it.
  // The settings page and its "重新探测" button call capabilities() explicitly.

  const HIGH_RISK_TOOLS = new Set(TOOLS.filter((tool) => (
    tool.destructive || (PERMISSION_OPERATION[tool.permission] || 'read') !== 'read'
  )).map((tool) => tool.name))

  // Defense in depth for PTC nested calls that may not traverse the host's
  // tools/pre-execute gate: read the session's own approval policy. If the
  // host says approval: never (danger-full-access), refuse high-risk tools
  // before touching the NAS; never turn the host's fail-closed policy into an
  // allow. When approval is 'ask', the tools/pre-execute gate below handles it.
  const hostApprovalPolicy = (exec) => {
    try {
      const approval = typeof ctx.get === 'function' ? ctx.get('approval', false) : undefined
      const session = exec?.agent?.session
      return approval && typeof approval.effectivePolicy === 'function' && session
        ? approval.effectivePolicy(session)
        : undefined
    } catch {
      return undefined
    }
  }

  const failure = makeFailure()
  for (const tool of TOOLS) {
    const isReadOnly = READ_ONLY.has(tool.name)
    const operation = PERMISSION_OPERATION[tool.permission] || 'read'
    const highRisk = tool.destructive || operation !== 'read'
    ctx.effect(
      () => ctx.tools.register(defineTool({
        name: tool.name,
        description: highRisk ? `${tool.description}【写/危险操作】` : tool.description,
        parameters: tool.parameters,
        output: { schema: { type: 'string' }, render: asText },
        async execute(args, exec) {
          try {
            if (HIGH_RISK_TOOLS.has(tool.name) && settings.confirmMode !== 'off'
              && hostApprovalPolicy(exec) === 'never') {
              return '操作被拒绝：当前 DSH 会话为「完全权限」档（approval: never），宿主不会弹出审批窗口，已拒绝执行。'
            }
            return await tool.run(args, call)
          } catch (error) {
            return failure(error, tool)
          }
        },
      }), {
        when: () => {
          if (settings.mode === 'readonly' && !isReadOnly) return false
          if (settings.accessLevel === 'user' && (tool.admin || ADMIN_GROUPS.has(tool.group))) return false
          if (!settings.endpoint || !settings.accessToken) return false
          return capabilities.isReady(tool.group)
        },
      }),
      `dsh-ugreen-nas: ${tool.name}`,
    )
  }

  // Deliberately use DSH's approval seam, matching the host policy. The
  // settings page carries the same warning for the danger-full-access case.
  if (typeof ctx.on === 'function') {
    ctx.effect(
      () => ctx.on('tools/pre-execute', async (exec, next) => {
        if (!HIGH_RISK_TOOLS.has(exec?.name)) return next()
        if (settings.confirmMode === 'off') return next()
        return {
          kind: 'ask',
          reason: `绿联 NAS 高风险操作：${exec.name}`,
          displayReason: {
            en: `Allow this high-risk UGREEN NAS operation? (${exec.name})`,
            zh: `允许执行这次绿联 NAS 高风险操作吗？（${exec.name}）`,
          },
        }
      }),
      'dsh-ugreen-nas: high-risk approval gate',
    )
  }
}

export default { name, inject, Config, apply }