/**
 * Tool catalog for dsh-ugreen-nas, one entry per model-facing tool.
 *
 * Each entry: { name, description, parameters, group, permission, destructive?, run(args, call) }.
 * `group` gates registration on the token's probed capability; `permission`
 * names the openapi.json permission the tool needs, so a 403 can tell the
 * model exactly which grant is missing on the NAS side.
 */

/** permission id -> operation, from the apps' openapi.json (source of the NAS-side grants). */
export const PERMISSION_OPERATION = {
  app_detail: 'read', app_search_and_available_updates: 'read', app_install_stream: 'write',
  app_uninstall_stream: 'delete', app_update_stream: 'write', app_stop: 'execute', app_start: 'execute',
  ctl_user_group_list: 'read', ctl_user_create: 'write', ctl_group_add_members: 'write',
  ctl_hardware_power: 'read', ctl_os_identity: 'read', ctl_os_update_status: 'read',
  ctl_network_general: 'read', ctl_network_connection: 'read',
  filemgr_list_and_attr: 'read', filemgr_read_and_download: 'read', filemgr_upload: 'write',
  filemgr_create_dir: 'write', filemgr_create_share_dir: 'write', filemgr_chtimes: 'write',
  filemgr_cp_move_path: 'write', filemgr_rename: 'write', filemgr_delete: 'delete',
  filemgr_recover_from_recycle: 'write', filemgr_get_quota: 'read', filemgr_set_quota: 'execute',
  filemgr_get_tag: 'read', filemgr_add_tag: 'write', filemgr_delete_tag: 'delete',
  title_search_task: 'read',
  'storage.disk.list': 'read', 'storage.pool.list': 'read', 'storage.disk.smart.all': 'read', 'storage.volume.list': 'read',
  taskmgr_get_run_overview: 'read', taskmgr_get_cpu_metric: 'read', taskmgr_get_gpu_metric: 'read',
  taskmgr_get_mem_metric: 'read', taskmgr_get_net_traffic: 'read', taskmgr_get_disk_metric: 'read',
  taskmgr_get_volume_metric: 'read', taskmgr_get_service_resource: 'read', taskmgr_get_process_resource: 'read',
  docker_image_search: 'read', docker_image_list: 'read', docker_image_pull: 'write',
  docker_container_list: 'read', docker_container_start: 'execute', docker_container_stop: 'execute',
  docker_container_restart: 'execute', docker_container_logs: 'read',
  docker_compose_project_create: 'write', docker_compose_project_list: 'read', docker_compose_project_logs: 'read',
  docker_compose_project_start: 'execute', docker_compose_project_stop: 'execute',
  docker_compose_project_restart: 'execute', docker_compose_project_delete: 'delete',
  docker_app_discrete_gpu_check: 'read', docker_container_port_check: 'read', docker_container_directory_check: 'read',
  docker_app_usage: 'read', docker_app_rebuild: 'execute',
  download_task_create: 'write', download_task_get: 'read', download_task_pause: 'write',
  download_task_resume: 'write', download_task_retry_failed: 'write', download_task_remove: 'delete',
}

export const isReadOnlyTool = (tool) => !tool.destructive && (PERMISSION_OPERATION[tool.permission] || 'read') === 'read'

const J = (value) => JSON.stringify(value, null, 2)
const PATH_HINT = '绝对路径，例如 /home/<user>/demo'

/** 模型偶尔会把单值传成标量而不是数组；统一宽容包装。 */
const asArray = (value) => {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

const fileTools = [
  {
    name: 'ugreen_file_stat', group: 'files', permission: 'filemgr_list_and_attr',
    description: '读取绿联 NAS 上文件或文件夹的属性（大小、类型、权限、时间戳）。',
    parameters: { path: { type: 'string', required: true, description: PATH_HINT } },
    run: async (args, call) => {
      const result = await call('files', 'ugidl.filesystem.Filesystem', 'Stat', { path: String(args.path) })
      return J(result.stat || result)
    },
  },
  {
    name: 'ugreen_file_list', group: 'files', permission: 'filemgr_list_and_attr',
    description: '列出绿联 NAS 文件夹内容；支持按路径或根目录类型浏览，返回名称、路径、大小、类型与修改时间。',
    parameters: {
      path: { type: 'string', description: '绝对路径；为空时用 rootType 选择根目录' },
      rootType: { type: 'integer', description: '根目录类型：1 收藏、2 个人文件夹、3 共享文件夹、4 用户文件夹、5 网络文件夹、6 外部设备、7 镜像、8 分享目录、9 标签；默认 2' },
      limit: { type: 'integer', description: '返回条数上限，0 表示不限' },
      page: { type: 'integer', description: '页码，默认 1' },
    },
    run: async (args, call) => {
      const request = {
        path: String(args.path || ''),
        root_type: Number(args.rootType) || (args.path ? 0 : 2),
        limit: Number(args.limit) || 0,
        page: Math.max(Number(args.page) || 1, 1),
      }
      const result = await call('files', 'ugidl.filesystem.Filesystem', 'CategoryOrFileDirList', request)
      const data = result.data || result
      const list = data.file_list || data.fileList || data
      return J({ topPath: list.top_path ?? list.topPath, total: list.total, entries: list.files || list.entries || [] })
    },
  },
  {
    name: 'ugreen_file_read', group: 'files', permission: 'filemgr_read_and_download',
    description: '读取绿联 NAS 上的文件内容；默认最多 256KB，文本直接返回，二进制返回 base64。',
    parameters: {
      path: { type: 'string', required: true, description: PATH_HINT },
      offset: { type: 'integer', description: '字节偏移，默认 0' },
      length: { type: 'integer', description: '读取字节数，默认 262144，最大 1048576' },
    },
    run: async (args, call) => {
      const length = Math.min(Math.max(Number(args.length) || 262144, 1), 1048576)
      const result = await call('files', 'ugidl.filesystem.Filesystem', 'ReadFile', {
        path: String(args.path), offset: Number(args.offset) || 0, length, is_dry_run: false,
      })
      const data = result.data ? Buffer.from(result.data, 'base64') : Buffer.alloc(0)
      const view = data.toString('utf8')
      const printable = !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(view)
      return J({
        path: args.path, bytesRead: result.bytes_read ?? data.length, eof: result.eof ?? undefined,
        ...(printable ? { text: view } : { base64: result.data || '' }),
      })
    },
  },
  {
    name: 'ugreen_file_write', group: 'files', permission: 'filemgr_upload',
    description: '写入绿联 NAS 上的文件：新建或覆盖（overwrite）、追加（append，旧文件需不大于 8MB）。文本直接传，二进制用 base64 并设 isBase64。',
    parameters: {
      path: { type: 'string', required: true, description: PATH_HINT },
      content: { type: 'string', required: true, description: '文本内容；或配合 isBase64 的 base64 数据' },
      isBase64: { type: 'boolean', description: 'content 是否为 base64 编码，默认 false' },
      mode: { type: 'string', enum: ['overwrite', 'append'], description: '写入模式，默认 overwrite' },
    },
    run: async (args, call) => {
      const incoming = args.isBase64 ? Buffer.from(String(args.content), 'base64') : Buffer.from(String(args.content), 'utf8')
      // 后端对 append/patch 要求 md5 一致性校验，这里统一实现为
      // 「读旧内容 → 拼接 → OVERWRITE 全量写」。
      let final = incoming
      if (args.mode === 'append') {
        const APPEND_LIMIT = 8 * 1024 * 1024
        let existing = Buffer.alloc(0)
        let offset = 0
        for (;;) {
          let chunk
          try {
            chunk = await call('files', 'ugidl.filesystem.Filesystem', 'ReadFile', {
              path: String(args.path), offset, length: 1048576, is_dry_run: false,
            })
          } catch (error) {
            // 目标不存在（HTTP 404 / gRPC NOT_FOUND）按新建文件处理；其余读取失败
            // （如权限不足）必须抛出，避免把空旧内容覆盖到已存在的文件上。
            if (offset === 0 && (error?.status === 404 || error?.code === 'grpc_5')) break
            throw error
          }
          const data = chunk.data ? Buffer.from(chunk.data, 'base64') : Buffer.alloc(0)
          existing = Buffer.concat([existing, data])
          offset += data.length
          if (chunk.eof || data.length === 0) break
          if (existing.length > APPEND_LIMIT) {
            throw new Error(`追加写入只支持 8MB 以内的旧文件：${args.path} 已读 ${offset} 字节仍未到文件尾，请改用完整覆写`)
          }
        }
        final = Buffer.concat([existing, incoming])
      }
      const result = await call('files', 'ugidl.filesystem.Filesystem', 'WriteFile', {
        path: String(args.path), content: final.toString('base64'),
        mode: 'WRITE_FILE_MODE_OVERWRITE', offset: 0, is_dry_run: false, total_size: final.length,
      })
      return J({ ok: true, path: args.path, bytes: final.length, response: result })
    },
  },
  {
    name: 'ugreen_file_mkdir', group: 'files', permission: 'filemgr_create_dir',
    description: '在绿联 NAS 上新建文件夹，可一次创建多级（make_all）。',
    parameters: {
      path: { type: 'string', required: true, description: PATH_HINT },
      makeAll: { type: 'boolean', description: '父目录不存在时一并创建，默认 true' },
    },
    run: async (args, call) => J(await call('files', 'ugidl.filesystem.Filesystem', 'CreateDir', {
      path: String(args.path), make_all: args.makeAll === undefined ? true : Boolean(args.makeAll), is_dry_run: false,
    })),
  },
  {
    name: 'ugreen_file_share_mkdir', group: 'files', permission: 'filemgr_create_share_dir',
    description: '在绿联 NAS 上新建共享文件夹（管理员能力）。',
    parameters: {
      volume: { type: 'string', required: true, description: '卷名，如 volume1' },
      name: { type: 'string', required: true, description: '共享文件夹名' },
      enableRecycle: { type: 'boolean', description: '是否开启回收站，默认 true' },
    },
    run: async (args, call) => J(await call('files', 'ugidl.filesystem.Filesystem', 'CreateShareFolder', {
      volume: String(args.volume), name: String(args.name), enable_recycle: args.enableRecycle === undefined ? true : Boolean(args.enableRecycle), is_dry_run: false,
    })),
  },
  {
    name: 'ugreen_file_rename', group: 'files', permission: 'filemgr_rename',
    description: '重命名绿联 NAS 上的文件或文件夹（同目录内改名）。',
    parameters: {
      dir: { type: 'string', required: true, description: '所在目录的绝对路径' },
      oldName: { type: 'string', required: true, description: '当前名称' },
      newName: { type: 'string', required: true, description: '新名称' },
    },
    run: async (args, call) => J(await call('files', 'ugidl.filesystem.Filesystem', 'Rename', {
      dir: String(args.dir), old_name: String(args.oldName), new_name: String(args.newName), is_dry_run: false,
    })),
  },
  {
    name: 'ugreen_file_move', group: 'files', permission: 'filemgr_cp_move_path',
    description: '复制或移动绿联 NAS 上的文件/文件夹到目标目录；跨目录改名请配合 ugreen_file_rename。',
    parameters: {
      src: { type: 'string', required: true, description: '源路径（单条）' },
      dstDir: { type: 'string', required: true, description: '目标目录（必须是已存在的目录）' },
      copy: { type: 'boolean', description: 'true=复制，false=移动，默认 false（移动）' },
      overwrite: { type: 'boolean', description: '同名时是否覆盖，默认 false' },
    },
    run: async (args, call) => J(await call('files', 'ugidl.filesystem.Filesystem', 'CpMovePath', {
      src: String(args.src), dst: String(args.dstDir), type: Boolean(args.copy),
      cover: Boolean(args.overwrite), is_dry_run: false,
    })),
  },
  {
    name: 'ugreen_file_delete', group: 'files', permission: 'filemgr_delete', destructive: true,
    description: '删除绿联 NAS 上的文件或文件夹。默认进回收站（可恢复）；forever=true 为永久删除，不可恢复，慎用。',
    parameters: {
      path: { type: 'string', required: true, description: PATH_HINT },
      forever: { type: 'boolean', description: 'true=永久删除（不可恢复），默认 false（进回收站）' },
    },
    run: async (args, call) => J(await call('files', 'ugidl.filesystem.Filesystem', 'DelPath', {
      path: String(args.path), forever: Boolean(args.forever), is_dry_run: false,
    })),
  },
  {
    name: 'ugreen_file_restore', group: 'files', permission: 'filemgr_recover_from_recycle',
    description: '把绿联 NAS 回收站里的文件恢复原位。',
    parameters: { path: { type: 'string', required: true, description: '回收站内条目的路径' } },
    run: async (args, call) => J(await call('files', 'ugidl.filesystem.Filesystem', 'RecoverFromRecycle', {
      path: String(args.path), is_dry_run: false,
    })),
  },
  {
    name: 'ugreen_file_chtimes', group: 'files', permission: 'filemgr_chtimes',
    description: '修改绿联 NAS 上文件或目录的时间戳（Unix 秒）。',
    parameters: {
      path: { type: 'string', required: true, description: PATH_HINT },
      atime: { type: 'integer', description: '访问时间（Unix 秒）' },
      mtime: { type: 'integer', description: '修改时间（Unix 秒）' },
    },
    run: async (args, call) => {
      const atime = Number(args.atime) || 0
      const mtime = Number(args.mtime) || 0
      if (!atime && !mtime) throw new Error('至少提供 atime 或 mtime 之一（Unix 秒），避免时间戳被意外重置')
      return J(await call('files', 'ugidl.filesystem.Filesystem', 'Chtimes', {
        path: String(args.path), atime, mtime, is_dry_run: false,
      }))
    },
  },
  {
    name: 'ugreen_file_tag_set', group: 'files', permission: 'filemgr_add_tag',
    description: '创建或更新绿联 NAS 的文件标签；带 tag_id 时为改名/改色。',
    parameters: {
      tagId: { type: 'integer', description: '要修改的标签 id（创建时留空）' },
      name: { type: 'string', required: true, description: '标签名' },
      colour: { type: 'string', description: '颜色值，如 #FF5733' },
    },
    run: async (args, call) => {
      const info = { name: String(args.name), colour: String(args.colour || '') }
      if (args.tagId) {
        info.tag_id = Number(args.tagId)
        return J(await call('files', 'filemgr.Filemgr', 'SetTag', { tag_info: [info], is_dry_run: false }))
      }
      return J(await call('files', 'filemgr.Filemgr', 'AddTag', { tag_infos: [info], is_dry_run: false }))
    },
  },
  {
    name: 'ugreen_file_tag_link', group: 'files', permission: 'filemgr_add_tag',
    description: '把标签挂到绿联 NAS 的文件/文件夹上（action=remove 为摘除）。',
    parameters: {
      paths: { type: 'array', items: { type: 'string' }, required: true, description: '要打标签的路径列表' },
      tagId: { type: 'integer', required: true, description: '标签 id（可从 ugreen_file_tag_list 获取）' },
      action: { type: 'string', enum: ['add', 'remove'], description: '默认 add' },
    },
    run: async (args, call) => {
      const paths = asArray(args.paths).map(String)
      const method = args.action === 'remove' ? 'DeleteFileTag' : 'AddFileTag'
      return J(await call('files', 'filemgr.Filemgr', method, { paths, tag_id: Number(args.tagId), is_dry_run: false }))
    },
  },
  {
    name: 'ugreen_file_tag_list', group: 'files', permission: 'filemgr_get_tag',
    description: '列出绿联 NAS 上已创建的文件标签。',
    parameters: {},
    run: async (_args, call) => J(await call('files', 'filemgr.Filemgr', 'getUserTag', { value: 0 })),
  },
  {
    name: 'ugreen_file_quota', group: 'files', permission: 'filemgr_get_quota',
    description: '查询或设置用户目录的空间配额（管理员能力；action=set 需要 filemgr_set_quota 权限）。',
    parameters: {
      path: { type: 'string', required: true, description: '用户目录路径，如 /volume1/@home/<user>' },
      action: { type: 'string', enum: ['get', 'set'], description: '默认 get' },
      quotaGb: { type: 'number', description: 'action=set 时的配额（GB）' },
    },
    run: async (args, call) => {
      if (args.action === 'set') {
        const gb = Number(args.quotaGb)
        if (!Number.isFinite(gb) || gb <= 0) throw new Error('action=set 时必须提供正数 quotaGb（单位 GB）')
        const quota = Math.round(gb * 1024 * 1024 * 1024)
        return J(await call('files', 'filemgr.Filemgr', 'SetQuota', { path: String(args.path), quota, is_dry_run: false }))
      }
      return J(await call('files', 'filemgr.Filemgr', 'GetQuota', { path: String(args.path) }))
    },
  },
]

const coreTools = [
  {
    name: 'ugreen_connection_test', group: 'app', permission: 'app_detail',
    description: '测试绿联 NAS 访问令牌与 OpenCLI 连接；返回指定应用的运行状态。首次配置或排错时先调用。',
    parameters: { appIds: { type: 'array', items: { type: 'string' }, description: '应用 ID 列表，默认 ["com.ugreen.appmgr"]' } },
    run: async (args, call) => {
      const ids = asArray(args.appIds).map(String)
      const result = await call('app', 'app.App', 'GetAppStatus', { ids: ids.length ? ids : ['com.ugreen.appmgr'] })
      return J({ ok: true, apps: result.status || result })
    },
  },
]

const storageTools = [
  {
    name: 'ugreen_storage_info', group: 'storage', permission: 'storage.disk.list',
    description: '查询绿联 NAS 的磁盘、存储池与卷信息（容量、已用、文件系统、挂载点、健康状态、温度）。',
    parameters: {},
    run: async (_args, call) => {
      const [disks, pools, volumes] = await Promise.all([
        call('storage', 'storage.Storage', 'DiskList', { value: '' }),
        call('storage', 'storage.Storage', 'PoolList', {}),
        call('storage', 'storage.Storage', 'VolumeList', {}),
      ])
      return J({ disks: disks.list || disks, pools: pools.pool_list || pools, volumes: volumes.volumes || volumes })
    },
  },
]

const taskTools = [
  {
    name: 'ugreen_task_overview', group: 'tasks', permission: 'taskmgr_get_run_overview',
    description: '查询绿联 NAS 任务管理器的运行总览：CPU、内存、GPU、风扇、网络和磁盘速率。',
    parameters: {},
    run: async (_args, call) => J(await call('tasks', 'taskserv.TaskManage', 'GetRunOverview', {})),
  },
]

const appTools = [
  {
    name: 'ugreen_app_status', group: 'app', permission: 'app_detail',
    description: '查询绿联 NAS 上指定应用的安装/运行/启用状态；不传 ids 时返回常用应用状态。',
    parameters: { ids: { type: 'array', items: { type: 'string' }, description: '应用 ID 列表，如 ["com.ugreen.filemgr"]' } },
    run: async (args, call) => {
      const ids = asArray(args.ids).map(String)
      const result = await call('app', 'app.App', 'GetAppStatus', { ids: ids.length ? ids : ['com.ugreen.appmgr', 'com.ugreen.filemgr'] })
      return J(result.status || result)
    },
  },
  {
    name: 'ugreen_app_install', group: 'app', permission: 'app_install_stream', destructive: true,
    description: '在绿联 NAS 上安装指定应用（从应用中心）。安装会下载并部署应用，请确认磁盘空间与来源。',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, required: true, description: '应用 ID 列表' },
      noStart: { type: 'boolean', description: '安装后不自动启动，默认 false' },
    },
    run: async (args, call) => J(await call('app', 'app.App', 'Install', {
      ids: asArray(args.ids).map(String), no_start: Boolean(args.noStart), as_default: false,
    })),
  },
  {
    name: 'ugreen_app_uninstall', group: 'app', permission: 'app_uninstall_stream', destructive: true,
    description: '卸载绿联 NAS 上的应用；clean=true 时同时清理应用用户数据。卸载后应用及其服务会消失，不可恢复。',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, required: true, description: '应用 ID 列表' },
      clean: { type: 'boolean', description: '是否同时删除应用用户数据，默认 false' },
    },
    run: async (args, call) => J({
      results: await call.stream('app', 'app.App', 'UninstallStream', {
        ids: asArray(args.ids).map(String),
        clean: Boolean(args.clean),
      }, { timeoutMs: 180000 }),
    }),
  },
  {
    name: 'ugreen_app_update', group: 'app', permission: 'app_update_stream', destructive: true,
    description: '更新绿联 NAS 上已安装的应用到可用新版本；更新过程会下载并重启应用。',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, required: true, description: '应用 ID 列表' },
    },
    run: async (args, call) => J({
      results: await call.stream('app', 'app.App', 'UpdateStream', {
        ids: asArray(args.ids).map(String),
      }, { timeoutMs: 300000 }),
    }),
  },
  {
    name: 'ugreen_app_start', group: 'app', permission: 'app_start',
    description: '启动绿联 NAS 上已安装的应用。',
    parameters: { id: { type: 'string', required: true, description: '应用 ID，如 com.ugreen.filemgr' } },
    run: async (args, call) => J(await call('app', 'app.App', 'Start', { app_id: String(args.id) })),
  },
  {
    name: 'ugreen_app_stop', group: 'app', permission: 'app_stop', destructive: true,
    description: '停用绿联 NAS 上正在运行的应用（对应服务会中断）。',
    parameters: { id: { type: 'string', required: true, description: '应用 ID' } },
    run: async (args, call) => J(await call('app', 'app.App', 'Stop', { app_id: String(args.id) })),
  },
]

const dockerTools = [
  {
    name: 'ugreen_docker_list', group: 'docker', permission: 'docker_container_list',
    description: '列出绿联 NAS 上的 Docker 容器（名称、镜像、状态、CPU/内存占用、端口映射）。',
    parameters: {
      name: { type: 'string', description: '按容器名过滤，可选' },
      page: { type: 'integer', description: '页码，默认 1' },
      pageSize: { type: 'integer', description: '每页数量，默认 50，最大 200' },
    },
    run: async (args, call) => {
      const result = await call('docker', 'docker.Docker', 'ContainerList', {
        container_name: String(args.name || ''),
        page_num: Math.max(Number(args.page) || 1, 1),
        page_size: Math.min(Math.max(Number(args.pageSize) || 50, 1), 200),
      })
      return J(result.result || result)
    },
  },
  {
    name: 'ugreen_docker_logs', group: 'docker', permission: 'docker_container_logs',
    description: '读取绿联 NAS 上指定 Docker 容器最近日志。',
    parameters: {
      containerId: { type: 'string', required: true, description: '容器 ID（可从 ugreen_docker_list 获取）' },
      raw: { type: 'boolean', description: '是否返回原始日志，默认 false' },
    },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'GetContainerLogs', {
      container_id: String(args.containerId), raw_data: Boolean(args.raw),
    })),
  },
  {
    name: 'ugreen_docker_start', group: 'docker', permission: 'docker_container_start',
    description: '启动绿联 NAS 上的指定 Docker 容器。',
    parameters: { containerId: { type: 'string', required: true, description: '容器 ID' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'StartContainer', { container_id: String(args.containerId) })),
  },
  {
    name: 'ugreen_docker_stop', group: 'docker', permission: 'docker_container_stop', destructive: true,
    description: '停止绿联 NAS 上的指定 Docker 容器（容器与配置保留，服务会中断）。',
    parameters: { containerId: { type: 'string', required: true, description: '容器 ID' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'StopContainer', { container_id: String(args.containerId) })),
  },
  {
    name: 'ugreen_docker_restart', group: 'docker', permission: 'docker_container_restart', destructive: true,
    description: '重启绿联 NAS 上的指定 Docker 容器（服务会短暂中断）。',
    parameters: { containerId: { type: 'string', required: true, description: '容器 ID' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'RestartContainer', { container_id: String(args.containerId) })),
  },
  {
    name: 'ugreen_docker_compose_list', group: 'docker', permission: 'docker_compose_project_list',
    description: '列出绿联 NAS 上的 Docker Compose 项目。',
    parameters: { name: { type: 'string', description: '按项目名过滤，可选' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'GetComposeProjectList', { project_name: String(args.name || '') })),
  },
  {
    name: 'ugreen_docker_compose_logs', group: 'docker', permission: 'docker_compose_project_logs',
    description: '读取绿联 NAS 上指定 Compose 项目的容器日志。',
    parameters: { name: { type: 'string', required: true, description: '项目名' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'GetComposeProjectLogs', { project_name: String(args.name) })),
  },
  {
    name: 'ugreen_docker_compose_create', group: 'docker', permission: 'docker_compose_project_create', destructive: true,
    description: '在绿联 NAS 上从 Compose 配置创建项目，可选择创建后立即拉取镜像并启动。',
    parameters: {
      name: { type: 'string', required: true, description: '项目名' },
      path: { type: 'string', required: true, description: '项目目录（NAS 绝对路径）' },
      content: { type: 'string', required: true, description: 'compose.yaml 内容（YAML 文本）' },
      run: { type: 'boolean', description: '创建后立即启动，默认 false' },
    },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'CreateComposeProject', {
      project_name: String(args.name), project_path: String(args.path), project_content: String(args.content), run_project: Boolean(args.run),
    })),
  },
  {
    name: 'ugreen_docker_compose_start', group: 'docker', permission: 'docker_compose_project_start',
    description: '启动绿联 NAS 上指定 Compose 项目的容器。',
    parameters: { name: { type: 'string', required: true, description: '项目名' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'StartComposeProject', { project_name: String(args.name) })),
  },
  {
    name: 'ugreen_docker_compose_stop', group: 'docker', permission: 'docker_compose_project_stop', destructive: true,
    description: '停止绿联 NAS 上指定 Compose 项目的容器。',
    parameters: { name: { type: 'string', required: true, description: '项目名' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'StopComposeProject', { project_name: String(args.name) })),
  },
  {
    name: 'ugreen_docker_compose_restart', group: 'docker', permission: 'docker_compose_project_restart', destructive: true,
    description: '重启绿联 NAS 上指定 Compose 项目（服务会短暂中断）。',
    parameters: { name: { type: 'string', required: true, description: '项目名' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'RestartComposeProject', { project_name: String(args.name) })),
  },
  {
    name: 'ugreen_docker_compose_delete', group: 'docker', permission: 'docker_compose_project_delete', destructive: true,
    description: '删除绿联 NAS 上指定 Compose 项目及其容器；deleteImages=true 连同未被引用的镜像一起删除。不可恢复。',
    parameters: {
      name: { type: 'string', required: true, description: '项目名' },
      deleteImages: { type: 'boolean', description: '是否同时删除镜像，默认 false' },
    },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'DeleteComposeProject', {
      project_name: String(args.name), delete_images: Boolean(args.deleteImages),
    })),
  },
  {
    name: 'ugreen_docker_image_search', group: 'docker', permission: 'docker_image_search',
    description: '在镜像仓库中按名称搜索镜像。',
    parameters: {
      name: { type: 'string', required: true, description: '镜像名关键词' },
      page: { type: 'integer', description: '页码，默认 1' },
      pageSize: { type: 'integer', description: '每页数量，默认 10' },
    },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'SearchImage', {
      image_name: String(args.name), page_num: Math.max(Number(args.page) || 1, 1), page_size: Math.min(Math.max(Number(args.pageSize) || 10, 1), 50),
    })),
  },
  {
    name: 'ugreen_docker_image_list', group: 'docker', permission: 'docker_image_list',
    description: '列出绿联 NAS 本地的 Docker 镜像。',
    parameters: { name: { type: 'string', description: '按镜像名过滤，可选' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'ShowLocalImage', { image_name: String(args.name || '') })),
  },
  {
    name: 'ugreen_docker_image_pull', group: 'docker', permission: 'docker_image_pull',
    description: '在绿联 NAS 上拉取指定镜像（后台任务，会占用磁盘与带宽）。',
    parameters: { imageRef: { type: 'string', required: true, description: '镜像引用，如 nginx:latest' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'PullImage', { image_ref: String(args.imageRef) })),
  },
  {
    name: 'ugreen_docker_app_usage', group: 'docker', permission: 'docker_app_usage',
    description: '查看绿联 NAS 上容器应用的资源占用（CPU/内存/网络/磁盘）。',
    parameters: { appIds: { type: 'array', items: { type: 'string' }, description: '容器应用 ID 列表' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'GetAppUsage', {
      app_ids: asArray(args.appIds).map(String),
    })),
  },
  {
    name: 'ugreen_docker_app_rebuild', group: 'docker', permission: 'docker_app_rebuild', destructive: true,
    description: '按配置强制重建绿联 NAS 上的容器应用（服务会短暂中断）。',
    parameters: { appId: { type: 'string', required: true, description: '容器应用 ID' } },
    run: async (args, call) => J(await call('docker', 'docker.Docker', 'RebuildContainerApp', { app_id: String(args.appId) })),
  },
]

const downloadTools = [
  {
    name: 'ugreen_download_list', group: 'downloads', permission: 'download_task_get',
    description: '查询绿联 NAS 下载中心的任务列表与状态。',
    parameters: { taskIds: { type: 'array', items: { type: 'integer' }, description: '任务 ID 列表；留空返回全部' } },
    run: async (args, call) => {
      const ids = asArray(args.taskIds).map(Number)
      const result = await call('downloads', 'download.DownloadService', 'BatchGetDownloadTask', { task_ids: ids })
      return J(result.tasks || result)
    },
  },
  {
    name: 'ugreen_download_create', group: 'downloads', permission: 'download_task_create',
    description: '在绿联 NAS 下载中心创建下载任务（HTTP 链接）。',
    parameters: {
      url: { type: 'string', required: true, description: '下载链接' },
      saveDirectory: { type: 'string', required: true, description: '保存目录（NAS 绝对路径，须有写入权限）' },
    },
    run: async (args, call) => J(await call('downloads', 'download.DownloadService', 'CreateDownload', {
      url: String(args.url), save_directory: String(args.saveDirectory),
    })),
  },
  {
    name: 'ugreen_download_pause', group: 'downloads', permission: 'download_task_pause',
    description: '暂停绿联 NAS 上指定的下载任务。',
    parameters: { taskIds: { type: 'array', items: { type: 'integer' }, required: true, description: '任务 ID 列表' } },
    run: async (args, call) => J(await call('downloads', 'download.DownloadService', 'PauseDownloadTask', {
      task_ids: asArray(args.taskIds).map(Number),
    })),
  },
  {
    name: 'ugreen_download_resume', group: 'downloads', permission: 'download_task_resume',
    description: '恢复绿联 NAS 上已暂停的下载任务。',
    parameters: { taskIds: { type: 'array', items: { type: 'integer' }, required: true, description: '任务 ID 列表' } },
    run: async (args, call) => J(await call('downloads', 'download.DownloadService', 'ResumeDownloadTask', {
      task_ids: asArray(args.taskIds).map(Number),
    })),
  },
  {
    name: 'ugreen_download_retry', group: 'downloads', permission: 'download_task_retry_failed',
    description: '重新调度绿联 NAS 上失败的下载任务。',
    parameters: { taskIds: { type: 'array', items: { type: 'integer' }, required: true, description: '任务 ID 列表' } },
    run: async (args, call) => J(await call('downloads', 'download.DownloadService', 'ForceStartFailedDownloadTask', {
      task_ids: asArray(args.taskIds).map(Number),
    })),
  },
  {
    name: 'ugreen_download_remove', group: 'downloads', permission: 'download_task_remove', destructive: true,
    description: '移除绿联 NAS 上未完成的下载任务（已下载的文件保留）。',
    parameters: { taskIds: { type: 'array', items: { type: 'integer' }, required: true, description: '任务 ID 列表' } },
    run: async (args, call) => J(await call('downloads', 'download.DownloadService', 'RemoveDownloadTask', {
      task_ids: asArray(args.taskIds).map(Number),
    })),
  },
]

const ctlTools = [
  {
    name: 'ugreen_system_info', group: 'ctl', permission: 'ctl_os_identity',
    description: '查询绿联 NAS 系统信息：系统版本、设备型号、序列号、固件版本、更新状态。',
    parameters: {},
    run: async (_args, call) => {
      const [identity, device, update] = await Promise.all([
        call('ctl', 'ctlserv.Internal', 'GetOsIdentity', {}),
        call('ctl', 'ctlserv.Internal', 'GetDeviceBasicInfo', {}),
        call('ctl', 'ctlserv.Internal', 'GetOsUpdateStatus', {}).catch(() => undefined),
      ])
      return J({ identity, device, update })
    },
  },
  {
    name: 'ugreen_user_list', group: 'ctl', permission: 'ctl_user_group_list',
    description: '查询绿联 NAS 的账号与用户组（只读）。',
    parameters: {},
    run: async (_args, call) => {
      const [users, groups] = await Promise.all([
        call('ctl', 'ctlserv.Internal', 'GetUgreenUserList', {}),
        call('ctl', 'ctlserv.Internal', 'GetCreatedGroupList', {}).catch(() => undefined),
      ])
      return J({ users, groups })
    },
  },
  {
    name: 'ugreen_user_create', group: 'ctl', permission: 'ctl_user_create', destructive: true,
    description: '在绿联 NAS 上创建普通账号并设置密码（管理员能力）。会新建可登录的账号，请确认必要性。',
    parameters: {
      username: { type: 'string', required: true, description: '用户名' },
      password: { type: 'string', required: true, description: '初始密码（须满足 NAS 密码强度规则）' },
      description: { type: 'string', description: '备注' },
    },
    run: async (args, call) => J(await call('ctl', 'ctlserv.Internal', 'CreateUser', {
      role: 'USERS', username: String(args.username), password: String(args.password),
      description: String(args.description || ''), enable_home_dir: true,
    })),
  },
  {
    name: 'ugreen_group_add_members', group: 'ctl', permission: 'ctl_group_add_members', destructive: true,
    description: '把用户加入绿联 NAS 的用户组。',
    parameters: {
      gid: { type: 'integer', required: true, description: '用户组 ID' },
      members: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true, description: '成员列表，如 [{"uid":1001,"name":"meiwei"}]' },
    },
    run: async (args, call) => J(await call('ctl', 'ctlserv.Internal', 'AddGroupMembers', {
      gid: Number(args.gid),
      members: (Array.isArray(args.members) ? args.members : []).map((m) => ({ uid: Number(m.uid) || 0, name: String(m.name || '') })),
    })),
  },
  {
    name: 'ugreen_hardware_info', group: 'ctl', permission: 'ctl_hardware_power',
    description: '查询绿联 NAS 硬件设置：风扇、蜂鸣器、CPU、LED、UPS。',
    parameters: {},
    run: async (_args, call) => {
      const [fan, beep, cpu, ups] = await Promise.all([
        call('ctl', 'ctlserv.Hardware', 'GetFanConfig', {}),
        call('ctl', 'ctlserv.Hardware', 'GetBeepConfig', {}).catch(() => undefined),
        call('ctl', 'ctlserv.Hardware', 'GetCpuConfig', {}).catch(() => undefined),
        call('ctl', 'ctlserv.Internal', 'GetUpsConfig', {}).catch(() => undefined),
      ])
      return J({ fan, beep, cpu, ups })
    },
  },
  {
    name: 'ugreen_network_info', group: 'ctl', permission: 'ctl_network_general',
    description: '查询绿联 NAS 网络配置：网关/DNS/代理与网卡列表。',
    parameters: {},
    run: async (_args, call) => {
      const [general, ifaces] = await Promise.all([
        call('ctl', 'ctlserv.Network', 'GetGeneralConfig', {}),
        call('ctl', 'ctlserv.Network', 'GetIfaceList', { value: '' }).catch(() => undefined),
      ])
      return J({ general, ifaces })
    },
  },
]

const extraTools = [
  {
    name: 'ugreen_search', group: 'search', permission: 'title_search_task',
    description: '按名称、类型、大小、时间搜索绿联 NAS 上的文件与目录（全局搜索），返回匹配路径与属性。',
    parameters: {
      query: { type: 'string', required: true, description: '搜索关键词（文件名或目录名）' },
      searchPaths: { type: 'array', items: { type: 'string' }, description: '搜索范围路径列表，默认 /home/<user>' },
      includeSubdirectories: { type: 'boolean', description: '是否包含子目录，默认 true' },
      fileSuffix: { type: 'string', description: '按后缀过滤，如 pdf、jpg' },
      maxResults: { type: 'integer', description: '最大结果数，默认 50' },
      minSize: { type: 'integer', description: '最小文件大小（字节）' },
      maxSize: { type: 'integer', description: '最大文件大小（字节）' },
      modifiedTimeFrom: { type: 'integer', description: '修改时间起（Unix 秒）' },
      modifiedTimeTo: { type: 'integer', description: '修改时间止（Unix 秒）' },
    },
    run: async (args, call) => {
      const messages = await call.stream('search', 'search.Search', 'CreateTitleStreamTask', {
        query: String(args.query || ''),
        search_paths: asArray(args.searchPaths).map(String),
        include_subdirectories: args.includeSubdirectories !== false,
        file_suffix: String(args.fileSuffix || ''),
        max_result_count: Math.min(Math.max(Number(args.maxResults) || 50, 1), 500),
        min_size: Number(args.minSize) || 0,
        max_size: Number(args.maxSize) || 0,
        modified_time_from: Number(args.modifiedTimeFrom) || 0,
        modified_time_to: Number(args.modifiedTimeTo) || 0,
      }, { timeoutMs: 120000 })
      const last = messages[messages.length - 1] || {}
      const seen = new Set()
      const items = []
      for (const message of messages) {
        for (const item of message.unordered_items || []) {
          const key = item.file_path || item.filePath
          if (key && !seen.has(key)) { seen.add(key); items.push(item) }
        }
      }
      return J({
        taskId: last.task_id ?? last.taskId,
        status: last.status,
        total: last.searched_total_count ?? last.searchedTotalCount ?? items.length,
        items,
      })
    },
  },
  {
    name: 'ugreen_task_metrics', group: 'tasks', permission: 'taskmgr_get_cpu_metric',
    description: '按指标查询绿联 NAS 任务管理器：CPU/GPU/内存/网络/磁盘/卷/服务/进程资源。',
    parameters: {
      metric: { type: 'string', enum: ['cpu', 'gpu', 'mem', 'net', 'disk', 'volume', 'service', 'process'], required: true, description: '指标类型' },
      interval: { type: 'integer', description: '磁盘/卷指标的采样间隔（秒），默认 1' },
    },
    run: async (args, call) => {
      const map = {
        cpu: ['GetCpuMetric', {}], gpu: ['GetGpuMetric', {}], mem: ['GetMemMetric', {}],
        net: ['GetNetTraffic', {}], disk: ['GetDiskMetric', { interval: Number(args.interval) || 1 }],
        volume: ['GetVolumeMetric', { interval: Number(args.interval) || 1 }],
        service: ['GetServiceResource', {}], process: ['GetProcessResource', {}],
      }
      const [method, request] = map[args.metric] || map.cpu
      return J(await call('tasks', 'taskserv.TaskManage', method, request))
    },
  },
  {
    name: 'ugreen_storage_smart', group: 'storage', permission: 'storage.disk.smart.all',
    description: '读取绿联 NAS 所有硬盘的 S.M.A.R.T. 诊断信息（可能包含设备 SN、型号、健康详情）。',
    parameters: {},
    run: async (_args, call) => J(await call('storage', 'storage.Storage', 'AllDiskSmartInfo', {})),
  },
  {
    name: 'ugreen_docker_check', group: 'docker', permission: 'docker_container_port_check',
    description: '检查绿联 NAS 的容器相关占用：端口、目录、是否使用独立显卡。',
    parameters: {
      check: { type: 'string', enum: ['port', 'dir', 'gpu'], required: true, description: '检查类型' },
      port: { type: 'integer', description: 'check=port 时的端口号' },
      protocol: { type: 'string', enum: ['tcp', 'udp'], description: 'check=port 时的协议，默认 tcp' },
      dir: { type: 'string', description: 'check=dir 时的目录路径' },
      vendor: { type: 'string', enum: ['nvidia', 'amd', 'intel'], description: 'check=gpu 时的显卡厂商，默认 nvidia' },
    },
    run: async (args, call) => {
      if (args.check === 'dir') {
        if (!String(args.dir || '').trim()) throw new Error('check=dir 时必须提供要检查的目录路径')
        return J(await call('docker', 'docker.Docker', 'CheckDirUsedByContainer', { dir: String(args.dir) }))
      }
      if (args.check === 'gpu') {
        const vendor = String(args.vendor || 'nvidia').toUpperCase()
        return J(await call('docker', 'docker.Docker', 'HasAppUsingDiscreteGPU', { gpu_vendor: `GPU_VENDOR_${vendor}` }))
      }
      const port = Number(args.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('check=port 时必须提供 1-65535 之间的端口号')
      return J(await call('docker', 'docker.Docker', 'CheckPortOccupiedByContainer', {
        port, protocol: args.protocol === 'udp' ? 'PORT_PROTOCOL_UDP' : 'PORT_PROTOCOL_TCP',
      }))
    },
  },
  {
    name: 'ugreen_file_tag_delete', group: 'files', permission: 'filemgr_delete_tag',
    description: '删除绿联 NAS 上的文件标签。',
    parameters: { tagIds: { type: 'array', items: { type: 'integer' }, required: true, description: '标签 id 列表' } },
    run: async (args, call) => J(await call('files', 'filemgr.Filemgr', 'DeleteTag', {
      tag_id: asArray(args.tagIds).map(Number), is_dry_run: false,
    })),
  },
  {
    name: 'ugreen_app_list', group: 'app', permission: 'app_search_and_available_updates',
    description: '查看绿联 NAS 应用中心的应用、版本与可用更新。',
    parameters: {
      installedOnly: { type: 'boolean', description: '只看已安装应用，默认 true' },
      needUpdateOnly: { type: 'boolean', description: '只看有更新的应用，默认 false' },
    },
    run: async (args, call) => J(await call('app', 'app.App', 'DetailList', {
      option: { inst_only: args.installedOnly !== false, need_update_only: Boolean(args.needUpdateOnly) },
    })),
  },
]

export const TOOLS = [...coreTools, ...fileTools, ...storageTools, ...taskTools, ...appTools, ...dockerTools, ...downloadTools, ...ctlTools, ...extraTools]