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