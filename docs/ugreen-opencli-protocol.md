# 绿联 NAS 访问令牌 / OpenCLI 协议与 DSH 插件接入文档

> 文档状态：v0.1，基于 UGOS Pro 1.21.0.80330（构建 2026-10-23）实测整理
> 适用插件：dsh-ugreen-nas
> 说明：本文档只描述只读接口和协议逆向过程。没有在 NAS 上创建、修改或删除任何配置。

---

## 1. 结论先行

WorkBuddy 的「绿联云」连接器不是普通 REST，也不是 MCP。它连接的是绿联 NAS 的 OpenCLI 公共接口：

~~~text
WorkBuddy / DSH / 其他 Agent
        │  HTTPS + Bearer token + protobuf
        ▼
https://<NAS地址>:9443/ugreen/opencli/v1/<socket_id>/<full_method>
        │
        ▼
NAS nginx → app_serv → 各应用的 gRPC 服务
~~~

访问令牌是给第三方 Agent 的受权限约束的凭据，格式为：

~~~text
ugpoa_v1.<32 位 token_id>.<secret>
~~~

它和登录会话是两套东西：登录会话用于 NAS 网页，访问令牌用于 OpenCLI。令牌只在创建时完整显示一次，数据库保存的是摘要；权限来自各应用安装包内的 openapi.json。

本插件选择原生 DSH 插件路线：设置页由 DSH 宿主根据 Config schema 自动生成，工具直接用访问令牌调 OpenCLI，不依赖 SSH，也不要求把 NAS 账号密码交给 Agent。

---

## 2. 访问令牌

### 2.1 生成位置

控制面板 → 账号设置 → 访问令牌 → 创建访问令牌。

创建页可选：

- 令牌名称（例如 dsh）
- 用途说明
- 有效期：自定义日期或永不过期
- 业务权限：按应用分组的多选权限
- 高级设置：每分钟请求上限、最大并发

### 2.2 令牌格式

~~~text
ugpoa_v1.<token_id>.<secret>
~~~

- ugpoa_v1：固定前缀（UGREEN Open API v1）
- 中间 32 位 hex：access_token_id，用于管理接口定位令牌
- 最后一段：secret，服务端只存摘要；完整值只在创建成功页显示一次

### 2.3 权限模型

每个应用安装目录下有 openapi.json，格式：

~~~json
{
  "schema_version": 1,
  "socket": { "id": "ugreen.app.grpc" },
  "permissions": [
    {
      "id": "app_detail",
      "operation": "read",
      "role": "admin",
      "methods": ["/app.App/GetAppDetail", "/app.App/GetAppStatus"],
      "i18n": [
        { "lang_name": "zh-CN", "name": "查看应用、版本与运行状态", "description": "..." }
      ]
    }
  ]
}
~~~

关键点：

- socket.id 是 OpenCLI 路由中的 socket_id
- methods 是完整的 gRPC 方法名
- operation 是权限类型：read / write / execute / delete
- role 是所需账号角色：admin / user
- 令牌至少选择一个权限；权限跟随创建令牌的账号权限变化
- 不支持按文件夹或容器单独限权：给 Files 权限意味着该账号可访问的所有文件范围

当前机器上的 8 个应用（示例令牌选择了全部 70 项）：

| 应用 | socket_id | 权限数 |
|---|---|---:|
| App Center | ugreen.app.grpc | 7 |
| Control Panel | ugreen.ctlserv.internal.grpc | 8 |
| Files | ugreen.filemgr.internal.grpc | 15 |
| Universal Search | ugreen.search.grpc | 1 |
| Storage | ugreen.storage.grpc | 4 |
| Task Manager | ugreen.taskmgr.internal.grpc | 9 |
| Docker | ugreen.dockerserv.internal.grpc | 20 |
| Downloads | ugreen.downloadserv.internal.grpc | 6 |

### 2.4 令牌 metadata

管理接口（登录态）：

~~~text
GET /ugreen/v1/opencli/access-tokens?token=<登录 api_token>
GET /ugreen/v1/opencli/access-tokens/<access_token_id>?token=<登录 api_token>
POST /ugreen/v1/opencli/access-tokens
POST /ugreen/v1/opencli/access-tokens/<id>/rename
POST /ugreen/v1/opencli/access-tokens/<id>/disable
POST /ugreen/v1/opencli/access-tokens/<id>/restore
DELETE /ugreen/v1/opencli/access-tokens/<id>
~~~

管理接口使用登录态的 api_token（登录后保存在浏览器 proConfig.accessInfo.api_token，不是访问令牌），只允许从已登录的网页会话调用；第三方连接器使用访问令牌走 OpenCLI 公共接口。

---

## 3. OpenCLI HTTP 契约

### 3.1 路由

nginx 配置（/etc/nginx/conf.d/app_serv.conf）把两个路径分开：

~~~nginx
location ^~ /ugreen/opencli/v1/ {
    proxy_pass http://app_backend;  # unix:/var/ugreen/app_serv.sock
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $opencli_connection_upgrade;
}

location ^~ /ugreen/v1/opencli/ {
    # 访问令牌管理，复用登录态，仅管理员可用
    proxy_pass http://app_backend;
}
~~~

公共接口路由模板（从 app_serv 的 gin 路由字符串确认）：

~~~text
/ugreen/opencli/v1/:socket_id/*full_method
~~~

示例：

~~~text
POST /ugreen/opencli/v1/ugreen.app.grpc/app.App/GetAppStatus
POST /ugreen/opencli/v1/ugreen.filemgr.internal.grpc/ugidl.filesystem.Filesystem/Stat
POST /ugreen/opencli/v1/ugreen.taskmgr.internal.grpc/taskserv.TaskManage/GetRunOverview
POST /ugreen/opencli/v1/ugreen.dockerserv.internal.grpc/docker.Docker/ContainerList
POST /ugreen/opencli/v1/ugreen.downloadserv.internal.grpc/download.DownloadService/BatchGetDownloadTask
~~~

注意：socket_id 和 full_method 之间不是 URI 编码后的一个整体；full_method 中的 / 作为路径分隔符保留。

### 3.2 请求头

~~~http
Authorization: Bearer ugpoa_v1.<token_id>.<secret>
Content-Type: application/x-protobuf
Accept: application/x-protobuf
X-OpenCLI-Body-Format: protobuf
~~~

实测规则：

- 令牌只允许放在 Authorization 头
- query 参数或 cookie 中的 token 会被拒绝，返回 invalid_token_transport
- 请求体必须是 protobuf 二进制；X-OpenCLI-Body-Format: json 不能把 JSON 请求体变成合法请求
- 响应成功时 Content-Type: application/x-protobuf，gRPC 状态码在 X-GRPC-Code，0 为成功
- 响应失败时通常 Content-Type: application/json; charset=utf-8，body 形如：

~~~json
{
  "code": "grpc_error",
  "message": "Err - code: 1301, message: Access not allowed",
  "request_id": "..."
}
~~~

### 3.3 HTTP 状态与 gRPC 状态

| HTTP | X-GRPC-Code | 含义 |
|---|---|---|
| 200 | 0 | 成功，body 是 protobuf |
| 200 | 非 0 | gRPC 业务错误，body 是 JSON |
| 400 | — | 路由/令牌传输/Content-Type 错误 |
| 401 | — | 令牌无效、过期或缺失 |
| 403 | 7 | gRPC PermissionDenied |
| 415 | — | Content-Type 不是 application/x-protobuf / multipart/form-data |
| 424 | — | 目标应用不可用 |
| 500 | 13 | gRPC 内部错误，常见于请求消息字段不匹配 |

### 3.4 三种请求模式

OpenCLI 不只有一种模式，app_serv 的 pubopen handler 提供：

1. Unary（一元请求）
   POST /ugreen/opencli/v1/<socket_id>/<full_method>，body 为 protobuf 消息，响应为 protobuf 消息。当前插件使用这种。

2. Server streaming（服务端流）
   通过 WebSocket 升级，子协议：

   ~~~text
   ugreen.opencli.grpc-stream.v1
   ~~~

   请求头需要 Upgrade: websocket、Connection: Upgrade、Sec-WebSocket-Protocol: ugreen.opencli.grpc-stream.v1。适合日志持续跟踪、目录递归等长流。未提供目标方法时会返回 target method is not provided。

3. Upload（文件上传）
   Content-Type: multipart/form-data，app_serv 的 upload_handler.go 处理分片；返回 UploadResponse。下载/上传文件走独立消息，不建议把大文件塞进普通 unary。

### 3.5 实测样例

请求：

~~~http
POST /ugreen/opencli/v1/ugreen.app.grpc/app.App/GetAppStatus
Authorization: Bearer <dsh 访问令牌>
Content-Type: application/x-protobuf
~~~

请求 protobuf（逻辑值）：

~~~json
{ "ids": ["com.ugreen.filemgr"] }
~~~

编码后的请求体（hex）：

~~~text
0a 12 63 6f 6d 2e 75 67 72 65 65 6e 2e 66 69 6c 65 6d 67 72
~~~

返回值：

~~~http
HTTP/2 200
content-type: application/x-protobuf
x-grpc-code: 0
~~~

解码后的响应：

~~~json
{
  "status": {
    "com.ugreen.filemgr": {
      "is_installed": true,
      "is_running": true,
      "is_enable": true
    }
  }
}
~~~

---

## 4. 核心难点：openapi.json 没有 protobuf message 定义

### 4.1 openapi.json 能告诉我们的

openapi.json 只有：

- 应用 socket id
- 权限 id、操作类型、需要角色
- 权限对应的方法名
- 多语言名称/描述

它没有：

- 方法的输入消息类型（例如 appinfo.GetAppStatusRequest）
- 输出消息类型
- 字段编号、字段类型、repeated/optional/map
- 枚举值
- streaming 标记

只有方法名，无法直接构造 protobuf body。必须补 message 定义。

### 4.2 方案一：gRPC Reflection

如果 app 的 gRPC server 开启了 reflection，可以直接拉取完整的 FileDescriptorSet：

~~~bash
# 在 NAS 上或通过 SSH 端口转发操作 unix socket
grpcurl -plaintext -unix /var/ugreen/filemgr_serv.sock list
grpcurl -plaintext -unix /var/ugreen/filemgr_serv.sock describe ugidl.filesystem.Filesystem
grpcurl -plaintext -unix /var/ugreen/filemgr_serv.sock -proto-out-dir ./proto \
  ugidl.filesystem.Filesystem
~~~

实测结论：

- 当前 UGOS Pro 1.21.0.80330 的 app 二进制中没有找到 reflection.Register 符号
- 因此 reflection 很可能没有启用；即使未来启用，也只能在拿到 app 的 unix socket 后使用，不能直接通过 OpenCLI 公共 HTTP 接口调用 reflection
- 如果后续版本启用，这是最干净的方式：不需要逆向二进制，直接得到官方 FileDescriptorProto

### 4.3 方案二：从 Go 二进制提取 FileDescriptorProto（本插件采用）

UGOS 的应用服务基本都是 Go 编译的。Go 的 protobuf 生成代码会把每个 .proto 的 FileDescriptorProto 作为 file_xxx_proto_rawDesc 字节数组内嵌在二进制里。它没有压缩，但也没有全局索引，需要扫描。

#### 4.3.1 识别特征

一个 FileDescriptorProto 的开头是：

~~~text
0a <name_length> <proto file name>
~~~

例如：

~~~text
0a 15 "filemgr/filemgr.proto" 12 07 "filemgr"
~~~

后面的 12 07 "filemgr" 是 package 字段。

#### 4.3.2 扫描算法

1. 读取整个 ELF 二进制为 []byte
2. 搜索 ASCII .proto 字符串
3. 对每个命中位置，向前最多 300 字节寻找 0x0a（protobuf field 1，name）且长度字节与字符串长度一致的候选起点
4. 从候选起点开始，用 protobuf wire 规则逐个读取 field：
   - protowire.ConsumeTag
   - protowire.ConsumeFieldValue
   - 直到遇到非法 wire type / 越界
5. 把这段字节用 proto.Unmarshal 解析为 descriptorpb.FileDescriptorProto
6. 校验 fd.GetName() 与扫描到的文件名完全一致
7. 递归展开 message_type、nested_type、enum_type、service
8. 生成精简 catalog（见 4.3.4）

实现见：

- scripts/extract-descriptors.go（Go 工具）
- scripts/build-catalog.mjs（合并多个应用的 catalog）

#### 4.3.3 每类应用都要单独提取

一个应用二进制只内嵌自己依赖的 proto。需要分别处理：

~~~text
/ugreen/@appstore/com.ugreen.filemgr/sbin/filemgr_serv
/ugreen/@appstore/com.ugreen.storagemgr/sbin/storage_serv
/ugreen/@appstore/com.ugreen.taskmgr/sbin/taskmgr_serv
/volume1/@appstore/com.ugreen.docker/sbin/docker_serv
/volume1/@appstore/com.ugreen.downloadmgr/sbin/download_serv
~~~

本插件生成 lib/catalog.json 时实际覆盖：

- App Center：app.App
- Files：ugidl.filesystem.Filesystem、filemgr.Filemgr
- Storage：storage.Storage
- Task Manager：taskserv.TaskManage
- Docker：docker.Docker
- Downloads：download.DownloadService

#### 4.3.4 catalog 结构

lib/catalog.json 是插件运行时使用的精简 schema：

~~~json
{
  "files": ["filemgr/filemgr.proto"],
  "messages": {
    "ugidl.filesystem.cli.StatRequest": {
      "name": "ugidl.filesystem.cli.StatRequest",
      "fields": [
        { "name": "path", "number": 1, "type": "STRING", "jsonName": "path" },
        { "name": "is_dry_run", "number": 2, "type": "BOOL", "jsonName": "isDryRun" }
      ]
    }
  },
  "enums": {
    "ugidl.filesystem.common.FileType": ["FILE_TYPE_UNSPECIFIED", "FILE_TYPE_FILE", "FILE_TYPE_DIR"]
  },
  "services": {
    "ugidl.filesystem.Filesystem": {
      "name": "ugidl.filesystem.Filesystem",
      "methods": {
        "Stat": {
          "name": "Stat",
          "input": ".ugidl.filesystem.cli.StatRequest",
          "output": ".ugidl.filesystem.cli.StatResponse"
        }
      }
    }
  }
}
~~~

Go 工具会把嵌套 message 的完整名字展开（例如 FileDirListData 的嵌套 FileList 变成 ugidl.filesystem.cli.FileList 或 ...FileDirListData.FileList），并保留 map_entry 标记。

#### 4.3.5 局限

- 二进制可能是 stripped，没有普通 ELF symtab；但 Go 的 pclntab 和 raw descriptor 仍在，扫描不依赖符号表
- 如果新版本改变生成器或压缩 descriptor，需要更新扫描逻辑
- 只能拿到 app 自己链接进来的 proto；A 应用调 B 应用的 method 时，需要从 B 的二进制补 descriptor
- 不同 app 的同一个 message 可能有版本差异；合并时以实际 service 所属 app 的 catalog 为准

### 4.4 方案三：CLI / 黑盒探测（兜底）

每个应用可能带 agent_cli.json：

~~~json
[
  { "path": "bin/ug-filesystem-cli", "user_mode": "privileged" },
  { "path": "bin/ug-filemgr-cli", "user_mode": "privileged" }
]
~~~

例如 Files 应用自带：

- ug-filesystem-cli：+ls、+stat、+cat、+find、+du、+md5sum 等
- ug-filemgr-cli：+batch-mv、+batch-tag、+scan-dedupe 等

--help 会给出每个命令的参数名，这能反推 message 字段。配合 protoc --decode_raw 解码响应，就能补出字段编号：

~~~bash
ug-filesystem-cli +stat --path /home/<user> --uid 1000 --format json
protoc --decode_raw < response.bin
~~~

这条路线适合：

- 只差一两个方法、不想写完整 descriptor extractor
- 验证二进制提取出的字段是否正确
- 快速 PoC；不适合作为正式插件运行时依赖，因为这要求 SSH/本地执行权限，绕过了访问令牌权限模型

### 4.5 方案选择建议

| 场景 | 方案 |
|---|---|
| 新版本 app 启用了 reflection | 优先 gRPC reflection，最稳 |
| 当前 UGOS 1.21 版本 | 二进制 descriptor 提取（本插件已实现） |
| 个别方法/字段不明 | CLI --help + protoc --decode_raw 交叉验证 |
| 生产插件 | 只打包提取后的 catalog，不在用户机器上运行二进制扫描 |

---

## 5. 运行时 protobuf codec

插件没有引入 protobufjs 等重依赖，而是实现了 lib/protobuf.js：

- 编码：按 catalog 字段表递归写 protobuf wire
- 解码：按 catalog 字段表递归读，未知字段跳过
- 支持：
  - varint / zigzag / fixed32 / fixed64 / float / double
  - string / bytes（base64 进出）
  - bool / enum（枚举名与数字互转）
  - nested message / repeated / packed repeated / map entry
- JSON 映射：
  - 输入接受字段的 name 或 jsonName
  - 输出使用 name（snake_case），便于和 proto 对照
  - int64/uint64 超出 Number.MAX_SAFE_INTEGER 时返回字符串

调用链：

~~~js
const schema = methodSchema(catalog, 'ugidl.filesystem.Filesystem', 'Stat')
const body = encodeMessage(catalog, schema.inputType, { path: '/home/<user>' })
const value = decodeMessage(catalog, schema.outputType, responseBuffer)
~~~

---

## 6. 插件设计

### 6.1 目录结构

~~~text
dsh-ugreen-nas/
├── package.json
├── cordis.patch.yml
├── lib/
│   ├── index.js          # DSH host 插件入口：Config + 工具注册
│   ├── client.js         # browser half：plugins.bundle.config 配置页
│   ├── opencli.js        # HTTPS OpenCLI 客户端
│   ├── protobuf.js       # 动态 protobuf codec
│   └── catalog.json      # 从 NAS app 二进制提取的 schema
├── docs/
│   └── ugreen-opencli-protocol.md
├── scripts/
│   ├── build.sh
│   ├── extract-descriptors.go
│   └── build-catalog.mjs
└── test/
    └── smoke.test.mjs
~~~

### 6.2 设置页

插件的 browser half 通过 plugins.bundle.config 注册一个最小配置页；配置字段来自 Config schema，保存后由宿主回写设置并触发热加载：

| 字段 | 类型 | 说明 |
|---|---|---|
| endpoint | string | NAS 地址：IP、UGREENlink ID、DDNS 或完整 URL |
| accessToken | secret | 访问令牌；只保存在本机 settings，不回显给模型 |
| timeoutMs | natural | 请求超时，默认 15000ms |
| rejectUnauthorized | boolean | 自签证书保持 false |

地址归一化规则（normalizeEndpoint）：

- 192.168.1.10 → https://192.168.1.10:9443
- curi.cn27.ug.link → https://curi.cn27.ug.link
- 已带 http:// / https:// 的值原样使用
- 末尾斜杠会去掉

### 6.3 工具列表

当前 v0.1 只注册只读工具：

| 工具 | socket_id | service / method | 用途 |
|---|---|---|---|
| ugreen_connection_test | ugreen.app.grpc | app.App/GetAppStatus | 检查令牌与应用状态 |
| ugreen_file_stat | ugreen.filemgr.internal.grpc | ugidl.filesystem.Filesystem/Stat | 文件/目录属性 |
| ugreen_file_list | ugreen.filemgr.internal.grpc | ugidl.filesystem.Filesystem/CategoryOrFileDirList | 按路径/根目录浏览 |
| ugreen_file_read | ugreen.filemgr.internal.grpc | ugidl.filesystem.Filesystem/ReadFile | 小文件读取 |
| ugreen_storage_info | ugreen.storage.grpc | storage.Storage/DiskList + PoolList + VolumeList | 磁盘、存储池、卷 |
| ugreen_task_overview | ugreen.taskmgr.internal.grpc | taskserv.TaskManage/GetRunOverview | CPU/内存/风扇/网络/磁盘 |
| ugreen_docker_list | ugreen.dockerserv.internal.grpc | docker.Docker/ContainerList | 容器列表 |
| ugreen_docker_logs | ugreen.dockerserv.internal.grpc | docker.Docker/GetContainerLogs | 容器日志 |
| ugreen_download_list | ugreen.downloadserv.internal.grpc | download.DownloadService/BatchGetDownloadTask | 下载任务 |

### 6.4 只读策略

v0.1 不注册任何写工具：

- 没有删除、移动、重命名、上传、Docker 启停、应用安装/卸载
- 所有工具都是只读方法（operation=read 或等价只读）
- 即使访问令牌有全部 70 项权限，插件也只使用读方法
- 如果以后添加写工具，必须：
  - 单独的 allowWrite 设置
  - 逐次人工确认（DSH approval）
  - 单独的最小权限令牌
  - 对 delete 类操作强制二次确认

### 6.5 错误处理

OpenCLIError 带 code、status、requestId。工具返回中文错误文本，不抛到模型上下文之外：

- not_configured：提醒到设置页填地址/令牌
- network：连接失败，检查地址、端口、UGREENlink/DDNS
- timeout：提高 timeoutMs 或检查 NAS 负载
- grpc_error + message：NAS 侧业务错误，保留 request_id 方便对照 NAS 日志
- decode_failed：catalog 与 NAS 版本不匹配，需要重新提取 descriptor

### 6.6 性能与限流

- 令牌默认 600 次/分钟、10 并发；插件不主动并发大量请求
- ugreen_storage_info 用 Promise.all 并发 3 个只读方法，仍远低于限制
- 文件读取默认 256KB，最大 1MB；大文件请后续用 DownloadFile/流式接口，不要一次性塞进模型上下文
- 可以在后续版本加：
  - 进程内结果缓存（短 TTL）
  - 按端点/令牌复用 HTTPS Agent
  - 对相同查询去重

---

## 7. 关键方法 schema（摘录）

### 7.1 App Center

~~~text
service app.App
  rpc GetAppStatus(appinfo.GetAppStatusRequest) returns (appinfo.GetAppStatusResponse)

message GetAppStatusRequest {
  repeated string ids = 1;
}
message GetAppStatusResponse {
  map<string, AppServiceStatus> status = 1;
}
~~~

### 7.2 Files

~~~text
service ugidl.filesystem.Filesystem
  rpc Stat(StatRequest) returns (StatResponse)
  rpc CategoryOrFileDirList(FileDirListRequest) returns (FileDirListResponse)
  rpc ReadFile(ReadFileRequest) returns (ReadFileResponse)

message StatRequest {
  string path = 1;
  bool is_dry_run = 2;
}
message CategoryOrFileDirListRequest {
  repeated string volumes = 1;
  uint64 intranet_share_id = 2;
  string path = 3;
  RootFolderType root_type = 4;
  bool is_access_recycle = 5;
  string top_path = 6;
  int32 page = 7;
  int32 limit = 8;
  Sort sort_type = 9;
  bool reverse = 10;
  SharePermissionFilter permission = 11;
  repeated string file_exts = 12;
  bool is_shield_recycle = 13;
  bool as_dir = 14;
  bool show_dir = 15;
  FileDirListDataType data_type = 16;
  repeated string file_collation = 17;
  repeated FilterItems filter_items = 18;
  repeated string file_type_filter = 19;
  Operate operate = 20;
  repeated string tag_filter = 21;
}
~~~

### 7.3 Storage

~~~text
service storage.Storage
  rpc DiskList(common.SingleString) returns (disk.DiskList)
  rpc PoolList(google.protobuf.Empty) returns (pool.PoolList)
  rpc VolumeList(google.protobuf.Empty) returns (volume.VolumeList)
~~~

### 7.4 Task Manager

~~~text
service taskserv.TaskManage
  rpc GetRunOverview(google.protobuf.Empty) returns (taskcenter.RunOverview)
  rpc GetCpuMetric(google.protobuf.Empty) returns (taskcenter.CpuMetric)
  rpc GetMemMetric(google.protobuf.Empty) returns (taskcenter.MemMetric)
~~~

### 7.5 Docker

~~~text
service docker.Docker
  rpc ContainerList(container.ContainerListRequest) returns (container.ContainerListResponse)
  rpc GetContainerLogs(container.GetContainerLogsRequest) returns (container.GetContainerLogsResponse)
~~~

### 7.6 Downloads

~~~text
service download.DownloadService
  rpc BatchGetDownloadTask(BatchGetDownloadTaskRequest) returns (BatchGetDownloadTaskResponse)
~~~

---

## 8. 安全边界

1. 令牌是 bearer credential：任何拿到完整令牌的人都能在权限范围内调用，不要写入代码、README、日志或对话。
2. 插件设置中 accessToken 标记 role('secret')：DSH 设置页不回显给模型；但仍存在本机 settings 文件，注意文件权限。
3. 不要使用登录 cookie 代替访问令牌：登录 cookie 是网页会话，权限更大、生命周期不同；OpenCLI 明确拒绝 cookie token。
4. 只读优先：本插件 v0.1 只读。即使当前令牌有 70 项权限，也不注册写工具。
5. 最小权限令牌：正式使用时建议新建只读令牌，只勾选 Files/Storage/Task Manager 的 read 权限，避免把 Docker 启停、删除等能力交给 Agent。
6. HTTPS：默认 rejectUnauthorized=false 是为了兼容 NAS 自签证书；如果 NAS 有可信证书，建议设为 true。
7. 外网访问：UGREENlink/DDNS 只是传输通道，不改变 token 权限；不要把 OpenCLI 端口直接暴露到公网而不加额外防护。

---

## 9. 已知限制与后续路线

### 9.1 当前版本限制

- 只有只读工具，没有写操作
- 没有自定义 sidebar 面板；设置页由 DSH 自动生成
- 未实现服务器流（WebSocket）和文件上传
- catalog 基于 UGOS 1.21.0.80330；升级 NAS 系统后可能需要重新提取
- Readdir 是 server-streaming，不能用 unary 调用；文件列表改用 CategoryOrFileDirList
- /volume1 作为根路径会被 Files 服务拒绝；使用 /home/<user>、/volume1/@home/<user> 或共享目录路径

### 9.2 后续可加工具

- ugreen_file_find（Find + GetFindResult）
- ugreen_file_download（DownloadFile，流式/落盘）
- ugreen_file_upload（multipart upload）
- ugreen_storage_smart（AllDiskSmartInfo）
- ugreen_task_process（GetProcessResource）
- ugreen_docker_compose（ComposeProjectList）
- ugreen_search（SearchEngineService/StreamSearch）
- 写操作（明确要求、单独审批、单独令牌）

### 9.3 版本升级流程

1. 从 NAS 重新下载应用二进制
2. 运行 scripts/extract-descriptors.go 生成 catalog
3. 运行 scripts/build-catalog.mjs 合并/裁剪
4. 用 test/smoke.test.mjs 对只读工具做回归
5. 更新插件版本与 CHANGELOG

---

## 10. 验证记录（本次实测）

- UGOS Pro 版本：1.21.0.80330，构建 2026-10-23
- app_serv 版本：1.21.0.0111
- account-setting 版本：1.4.1.2128
- 访问令牌：dsh，70 项权限，永不过期，600 次/分钟，10 并发
- 已验证成功：

| 方法 | 结果 |
|---|---|
| app.App/GetAppStatus | HTTP 200, x-grpc-code 0，返回 filemgr/appmgr 状态 |
| ugidl.filesystem.Filesystem/Stat | HTTP 200，返回文件属性 |
| ugidl.filesystem.Filesystem/CategoryOrFileDirList | HTTP 200，返回个人/共享根目录 |
| ugidl.filesystem.Filesystem/ReadFile | HTTP 200，返回 base64 data |
| storage.Storage/DiskList | HTTP 200，返回 2 块磁盘 |
| storage.Storage/PoolList | HTTP 200，返回 2 个存储池 |
| storage.Storage/VolumeList | HTTP 200，返回 2 个卷 |
| taskserv.TaskManage/GetRunOverview | HTTP 200，CPU/内存/风扇/网络/磁盘 |
| docker.Docker/ContainerList | HTTP 200，容器列表 |
| download.DownloadService/BatchGetDownloadTask | HTTP 200，下载任务 |

- 失败样例（用于确认错误边界）：
  - 无 Authorization：HTTP 401 / unauthorized
  - query/cookie token：HTTP 400 / invalid_token_transport
  - JSON body：HTTP 500 / grpc code 13 / proto parse error
  - Readdir unary：HTTP 500 / cardinality violation（server streaming 不能走 unary）
  - /volume1 根路径：HTTP 403 / Access not allowed

---

## 11. 命令速查

~~~bash
# 安装依赖并语法检查
cd dsh-ugreen-nas
bash scripts/build.sh

# 仅生成 catalog（需要 NAS 二进制在本地）
cd scripts
go run extract-descriptors.go /path/to/filemgr_serv > ../lib/catalog-filemgr.json
node build-catalog.mjs

# 冒烟测试（需要 UGREEN_TOKEN）
UGREEN_TOKEN='<访问令牌>' node test/smoke.test.mjs
~~~

---

## 12. 参考资料（本机文件）

- nginx：/etc/nginx/conf.d/app_serv.conf
- app_serv 路由/字符串：/ugreen/@appstore/com.ugreen.appmgr/sbin/app_serv
- app 权限声明：/ugreen/@appstore/*/openapi.json
- Files CLI：/ugreen/@appstore/com.ugreen.filemgr/bin/ug-filesystem-cli
- 访问令牌管理前端：/desktop/account-setting/assets/index-Dgx0DmSO.js
- 访问令牌管理路由：/desktop/account-setting/#/localAccount/accessTokens
