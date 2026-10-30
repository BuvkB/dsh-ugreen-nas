# dsh-ugreen-nas

DSH（DeepSeek Harness）的绿联 NAS 连接器：用「访问令牌」调用 UGOS Pro 的 OpenCLI 公共接口，提供只读的文件、存储、任务、Docker 和下载查询工具。

## 它不是什么

- 不是 SSH 包装：工具不要求 NAS 账号密码或 SSH。
- 不是 MCP：OpenCLI 是绿联自己的 gRPC-over-HTTP/protobuf 协议；本插件是 DSH 原生插件。
- 不是全权限 Agent：v0.1 只注册只读工具，不包含删除、移动、上传、Docker 启停、应用安装/卸载。

## 安装

~~~bash
git clone https://github.com/BuvkB/dsh-ugreen-nas.git
cd dsh-ugreen-nas
bash scripts/build.sh
# 方式一：插件管理页选择本地目录安装
# 方式二：在 profile 的 package.json 加依赖（link:/path/to/dsh-ugreen-nas），
#        并把 dsh-ugreen-nas 加入 dsh.profile.bundles，然后重启 DSH
~~~

安装后在「设置 → 插件 → dsh-ugreen-nas」填写：

| 字段 | 示例 | 说明 |
|---|---|---|
| endpoint | https://192.168.1.10:9443 | IP 可省略 https:// 和 :9443；也支持 UGREENlink ID / DDNS |
| accessToken | <访问令牌> | 绿联控制面板创建的访问令牌；secret 字段不会回显 |
| timeoutMs | 15000 | 请求超时 |
| rejectUnauthorized | false | 自签证书保持 false |

## 工具

| 工具 | 作用 |
|---|---|
| ugreen_connection_test | 检查令牌与 appmgr/filemgr 状态 |
| ugreen_file_stat | 文件/目录属性 |
| ugreen_file_list | 按路径或根目录浏览文件 |
| ugreen_file_read | 读取小文件（默认 256KB） |
| ugreen_storage_info | 磁盘、存储池、卷 |
| ugreen_task_overview | CPU/内存/风扇/网络/磁盘总览 |
| ugreen_docker_list | Docker 容器列表 |
| ugreen_docker_logs | 容器日志 |
| ugreen_download_list | 下载任务列表 |

## 访问令牌权限总表（70 项）

UGOS Pro 的访问令牌按 8 个官方应用分成 8 个大类，创建令牌时按大类勾选。全部 70 项的分布：

| 大类（应用） | socket_id | 小计 | read | write | execute | delete |
|---|---|---:|---:|---:|---:|---:|
| App Center（应用中心） | ugreen.app.grpc | 7 | 2 | 2 | 2 | 1 |
| Control Panel（控制面板） | ugreen.ctlserv.internal.grpc | 8 | 6 | 2 | 0 | 0 |
| Files（文件管理） | ugreen.filemgr.internal.grpc | 15 | 4 | 8 | 1 | 2 |
| Universal Search（全局搜索） | ugreen.search.grpc | 1 | 1 | 0 | 0 | 0 |
| Storage（存储管理） | ugreen.storage.grpc | 4 | 4 | 0 | 0 | 0 |
| Task Manager（任务管理器） | ugreen.taskmgr.internal.grpc | 9 | 9 | 0 | 0 | 0 |
| Docker | ugreen.dockerserv.internal.grpc | 20 | 10 | 2 | 7 | 1 |
| Downloads（下载中心） | ugreen.downloadserv.internal.grpc | 6 | 1 | 4 | 0 | 1 |
| **合计** | | **70** | **37** | **18** | **10** | **5** |

完整 70 项明细：

<details>
<summary>点开查看全部 70 项</summary>

| 大类 | 权限 | 操作 | 角色 | 说明 |
|---|---|---|---|---|
| App Center | app_detail | read | admin | 查看应用、版本与运行状态 |
| App Center | app_search_and_available_updates | read | admin | 搜索应用与可用更新 |
| App Center | app_install_stream | write | admin | 安装指定应用 |
| App Center | app_uninstall_stream | delete | admin | 卸载指定应用 |
| App Center | app_update_stream | write | admin | 更新指定应用 |
| App Center | app_stop | execute | admin | 停用指定应用 |
| App Center | app_start | execute | admin | 启动指定应用 |
| Control Panel | ctl_user_group_list | read | admin | 查看账号与用户组列表 |
| Control Panel | ctl_user_create | write | admin | 创建普通账号并设置密码 |
| Control Panel | ctl_group_add_members | write | admin | 向用户组添加成员 |
| Control Panel | ctl_hardware_power | read | admin | 查看风扇/电源/UPS 等硬件设置 |
| Control Panel | ctl_os_identity | read | admin | 查看设备型号与系统版本 |
| Control Panel | ctl_os_update_status | read | admin | 查询系统更新状态与可用版本 |
| Control Panel | ctl_network_general | read | admin | 查看网关、DNS、代理等通用网络配置 |
| Control Panel | ctl_network_connection | read | admin | 查看网卡状态与 IP 配置 |
| Files | filemgr_list_and_attr | read | user | 浏览文件列表与属性 |
| Files | filemgr_read_and_download | read | user | 读取与下载文件内容 |
| Files | filemgr_upload | write | user | 上传文件 |
| Files | filemgr_create_dir | write | user | 新建文件夹 |
| Files | filemgr_create_share_dir | write | admin | 新建共享文件夹 |
| Files | filemgr_chtimes | write | user | 修改文件或目录时间戳 |
| Files | filemgr_cp_move_path | write | user | 复制或移动文件 |
| Files | filemgr_rename | write | user | 重命名文件 |
| Files | filemgr_delete | delete | user | 删除文件 |
| Files | filemgr_recover_from_recycle | write | user | 从回收站恢复文件 |
| Files | filemgr_get_quota | read | admin | 查询空间配额 |
| Files | filemgr_set_quota | execute | admin | 设置空间配额 |
| Files | filemgr_get_tag | read | user | 获取标签信息 |
| Files | filemgr_add_tag | write | user | 添加或设置标签 |
| Files | filemgr_delete_tag | delete | user | 删除标签 |
| Universal Search | title_search_task | read | user | 按名称/类型/大小/时间搜索文件 |
| Storage | storage.disk.list | read | admin | 查看内部磁盘列表 |
| Storage | storage.pool.list | read | admin | 查看存储池列表 |
| Storage | storage.disk.smart.all | read | admin | 读取所有硬盘 S.M.A.R.T. 诊断 |
| Storage | storage.volume.list | read | admin | 查看卷列表 |
| Task Manager | taskmgr_get_run_overview | read | admin | 查看 CPU/内存/风扇/网络/磁盘总览 |
| Task Manager | taskmgr_get_cpu_metric | read | admin | 查看 CPU 占用与温度 |
| Task Manager | taskmgr_get_gpu_metric | read | admin | 查看 GPU 占用 |
| Task Manager | taskmgr_get_mem_metric | read | admin | 查看内存占用 |
| Task Manager | taskmgr_get_net_traffic | read | admin | 查看网络收发速率 |
| Task Manager | taskmgr_get_disk_metric | read | admin | 查看硬盘读写速率 |
| Task Manager | taskmgr_get_volume_metric | read | admin | 查看卷读写速率 |
| Task Manager | taskmgr_get_service_resource | read | admin | 查看各服务资源占用 |
| Task Manager | taskmgr_get_process_resource | read | admin | 查看各进程资源占用 |
| Docker | docker_image_search | read | admin | 在镜像仓库搜索镜像 |
| Docker | docker_image_list | read | admin | 查看本地镜像 |
| Docker | docker_image_pull | write | admin | 拉取指定镜像 |
| Docker | docker_container_list | read | admin | 查看容器与运行状态 |
| Docker | docker_container_start | execute | admin | 启动容器 |
| Docker | docker_container_stop | execute | admin | 停止容器 |
| Docker | docker_container_restart | execute | admin | 重启容器 |
| Docker | docker_container_logs | read | admin | 查看容器日志 |
| Docker | docker_compose_project_create | write | admin | 创建 Compose 项目 |
| Docker | docker_compose_project_list | read | admin | 查看 Compose 项目 |
| Docker | docker_compose_project_logs | read | admin | 查看 Compose 项目日志 |
| Docker | docker_compose_project_start | execute | admin | 启动 Compose 项目 |
| Docker | docker_compose_project_stop | execute | admin | 停止 Compose 项目 |
| Docker | docker_compose_project_restart | execute | admin | 重启 Compose 项目 |
| Docker | docker_compose_project_delete | delete | admin | 删除 Compose 项目及容器 |
| Docker | docker_app_discrete_gpu_check | read | admin | 检查容器应用的独显占用 |
| Docker | docker_container_port_check | read | admin | 检查容器端口占用 |
| Docker | docker_container_directory_check | read | admin | 检查容器目录占用 |
| Docker | docker_app_usage | read | admin | 查看容器应用资源占用 |
| Docker | docker_app_rebuild | execute | admin | 按配置强制重建容器应用 |
| Downloads | download_task_create | write | user | 从链接或种子创建下载任务 |
| Downloads | download_task_get | read | user | 查看下载任务状态与进度 |
| Downloads | download_task_pause | write | user | 暂停下载任务 |
| Downloads | download_task_resume | write | user | 恢复下载任务 |
| Downloads | download_task_retry_failed | write | user | 重试失败的下载任务 |
| Downloads | download_task_remove | delete | user | 移除下载任务（保留文件） |

</details>

本插件用到的最小只读集（21 项，全部 read，不含任何写/删/执行）：Files 的
`filemgr_list_and_attr`、`filemgr_read_and_download`、`filemgr_get_tag`、`filemgr_get_quota`，
Universal Search 的 `title_search_task`，Storage 全部 4 项，Task Manager 全部 9 项，
Docker 的 `docker_container_list`、`docker_container_logs`，Downloads 的 `download_task_get`。

注意：Files 大类按创建令牌的账号授权，不支持按文件夹限权；勾选了 Files 的 read，
令牌就能读到该账号可见的所有文件。

## 文档

协议、令牌权限、protobuf 提取方法和设计细节见：

[docs/ugreen-opencli-protocol.md](docs/ugreen-opencli-protocol.md)

## 安全

- 访问令牌只放在插件设置中（role=secret），不要写进代码/日志/对话。
- 正式使用建议单独创建一个只读令牌，只勾选 Files/Storage/Task Manager 的 read 权限。
- 默认不校验自签 HTTPS 证书；有可信证书时可把 rejectUnauthorized 设为 true。
- 这个插件当前只读，所有工具都不会修改 NAS。

## 开发

~~~bash
bash scripts/build.sh
node test/smoke.test.mjs
~~~

生成 protobuf catalog 见 docs 第 4.3 节和 scripts/extract-descriptors.go。