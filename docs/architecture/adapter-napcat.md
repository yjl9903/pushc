# `@pushc/adapter-napcat`

## 定位与运行时

`packages/adapter-napcat` 直接导出继承 core `PushAdapter` 的 `NapCatAdapter` class。它依赖 `node-napcat-ts` 建立正向 WebSocket 连接，并依赖 `@pushc/core` 接入统一发送契约。constructor 的第二个 options 参数可注入 `factory`，以隔离 SDK 和真实 QQ 服务。

## 源码职责

| 文件             | 职责                                                             |
| ---------------- | ---------------------------------------------------------------- |
| `src/adapter.ts` | 组合配置、target、连接、取消与发送操作，实现 core adapter 契约。 |
| `src/config.ts`  | 解析 WebSocket、token 与 timeout 连接配置。                      |
| `src/target.ts`  | 解析 target partial，并校验私聊或群聊 ID。                       |
| `src/client.ts`  | 封装 SDK client 创建、惰性连接、复用、失败恢复与销毁。           |
| `src/error.ts`   | NapCat 错误码和错误类型。                                        |
| `src/types.ts`   | 公共配置、target、receipt、client 与注入类型。                   |
| `src/index.ts`   | 公共 API 导出。                                                  |

## Adapter 连接配置

`parseNapCatConfig` 只接受 snake_case 配置字段。camelCase 拼写和其他未知字段均返回 `INVALID_CONFIG`；实例公开的 `NapCatConfig` 和 `NapCatTargetConfig` 也使用 snake_case。

| 字段                   | 规则与默认值                                    |
| ---------------------- | ----------------------------------------------- |
| `base_url`             | 必填，只允许 `ws:` 或 `wss:`，由 `URL` 标准化。 |
| `access_token`         | 可选；trim 后的空字符串按未配置处理。           |
| `timeout_ms`           | 正安全整数，默认 10,000 ms。                    |
| `max_attachment_bytes` | 单次消息附件原始总字节上限，默认 33,554,432。   |

同一命名 NapCat adapter 实例代表一个 QQ 账号连接配置，可被多个私聊或群聊 target 引用。默认 SDK client 禁用自动重连，并将同一 timeout 作为 `apiTimeout`。

## Target 配置

adapter 顶层的 `user_id` 或 `group_id` 由 `NapCatAdapter` 私有保存为 target 默认字段。`parseTarget` 只允许 partial 包含这两个 snake_case 字段，执行顶层浅合并后调用 `parseNapCatTarget`；WebSocket、token、timeout 及未知字段均被拒绝。发送时省略 target 会从顶层 ID 生成 default；对象 target 会作为匿名临时 partial 解析，两者都不进入 registry。配置没有具名 targets 时，顶层必须提供其中一个 ID。

`parseNapCatTarget` 输出与 NapCat `send_msg` 参数一致的互斥 union：`{ user_id } | { group_id }`。

| 字段       | 规则          |
| ---------- | ------------- |
| `user_id`  | 私聊目标 ID。 |
| `group_id` | 群聊目标 ID。 |

两者必须且只能提供一个。ID 仅接受十进制数字，且转换后必须是正的 JavaScript 安全整数。

ID 在调用 SDK 前转换为 number，因此不支持超出安全整数范围的 QQ ID。

## Request 准备与附件

NapCatAdapter 的异步 `prepareRequest` 将 target ID 转为 number，按 normalized content 顺序
处理 text 与 attachment nodes，并同时构造公开 `receiptRequest` 与内部
`transportRequest`。attachment source
可以是本地路径或不含 credentials 的 HTTP(S) URL。只有显式 `scheme://` source 进入 URL
分类：HTTP(S) 通过，其他 scheme 拒绝；普通本地路径允许包含 `:`。相对路径基于调用 send
时捕获的 cwd 解析，必须最终指向可读普通文件；URL 由 NapCat 直接获取，pushc 不下载。
显式 attachment `name` 必须是单一安全文件名，`.`、`..`、路径分隔符与 control character
均被拒绝，不做静默截断。
显式 attachment `mediaType` 是权威值；缺省时 adapter 根据本地文件名或 URL pathname
后缀查询 MIME：
`image/*`、`audio/*`、`video/*` 分别映射到 image、record、video，其他映射为 file，未知
MIME 记为 `application/octet-stream`；类型分类不区分大小写，receipt 保留原始 MIME
字符串。这只是 preparation 阶段的初始类型。

模块边界上，`adapter.ts` 只协调 core lifecycle、timeout、连接和 SDK 调用；`request.ts`
组装公开 request 与实际 transport，并在 dispatch 前根据远程响应直接回填对应消息段；
`attachment.ts` 负责本地文件准备、URL metadata 和 MIME-to-segment 映射。

每个本地路径只打开一次；adapter 对同一个 file handle 执行普通文件与 size 校验，再以
调用方 signal 读取最多已校验 size 的内容，从而避免路径替换及先无限读取后检查上限。单次
消息的本地附件原始总字节数不得超过 `max_attachment_bytes`。每项计算 SHA-256 并在内部
转为 `base64://`。HTTP(S) URL 不受本地字节限制，完整 URL 原样进入内部 transport。公开
request 的本地附件保存 basename、MIME、size、SHA-256 和 `encoding: 'base64'`；远程附件
先 percent-decode pathname leaf，再去除解码后出现的路径分隔符，拒绝 control character，
并保存安全 basename、MIME、host 和 `encoding: 'url'`。它不保存 Base64、本地路径、完整
URL 或 query。每个 normalized text node 都以原始字符串生成一个 text segment，不 trim、
连接或丢弃空白节点。显式 AST 的 text/attachment 顺序保持不变；shortcut attachments 的
前置顺序已由 core normalize。

`send(..., { dryRun: true })` 完成本地文件读取、校验、编码与哈希以及远程 URL 校验，但不
探测或下载远程内容、不调用 factory、不连接、不上传且不调用 `send_msg`。正常 send 进入
`dispatchRequest` 后，只对未显式提供 `mediaType` 的远程附件以默认最多 8 个并发的 HEAD
请求读取标准 `Content-Type`；成功取得合法 MIME 时按原 attachment index 修正 transport
segment 与最终 receipt request，探测失败则保留 pathname 推断结果。显式 `mediaType` 不被
远端响应覆盖，也不会触发 HEAD。随后通过一次 `send_msg` 发送，资源 URL 仍由 NapCat 获取。

## 单次发送生命周期

adapter 惰性维护单个 WebSocket client：constructor 不连接，第一次真实 `send` 调用 `factory`
并建立连接；并发的首次发送共享同一连接 Promise，后续发送复用已连接 client，直到
`destroy` 断开并终止 adapter。

1. 使用原生 `AbortSignal.timeout()` 创建覆盖远程 MIME 探测、lazy connect 和 send 的操作级
   timeout，并通过 `AbortSignal.any()` 与调用方 signal、adapter destroy signal 组合。
2. 以可注入 Fetch 对未显式提供 `mediaType` 的远程附件发送 HEAD，默认并发上限为 8；
   合法响应 `Content-Type` 优先于 pathname 推断，非成功响应、无效 header 或普通网络失败
   降级使用初始类型。
3. 获取或惰性建立共享 WebSocket 连接。
4. target 的 `user_id` 或 `group_id` 与准备好的 transport message segments 直接传给 SDK；
   `title` 与 `param` 被明确忽略。
5. 调用 `send_msg`；response 将 `message_id` 转为 `{ messageId }`。
6. 成功 dispatch result 返回 response、summary 与最终 receipt request；core 组合 receipt。
   连接、发送、超时和取消返回失败 result；标准 Error 或 NapCat SDK failure object 的非空
   string `message` 被保留，其他异常使用稳定回退描述。
7. Promise 竞争结束后释放取消监听；原生组合 signal 管理父 signal 与 timeout，连接保留给
   后续发送。

`destroy` 幂等地取消进行中的等待并断开共享 client；断开连接失败由 lifecycle 调用方处理。连接建立失败会清除缓存，使后续发送可以重试。

## 错误与测试边界

`NapCatError` 使用 `INVALID_CONFIG` 和 `ABORTED`。请求形成后的 SDK、超时和取消错误转换为
失败 result；连接和 target 配置错误由 adapter send 边界转换为 `INVALID_CONFIG` result。

Vitest 通过临时本地文件与注入 mock client 覆盖 target 默认字段、partial 继承、连接字段
拒绝、私聊/群聊参数映射、attachment-only、MIME segment 映射、Base64 与 HTTP(S) URL
transport、包含冒号的相对路径、安全远程 basename、control character 拒绝、公开 receipt
脱敏、大小限制、dry run 不下载且无连接、SDK failure、失败清理、远程 Content-Type 类型
修正与并行探测、调用方取消和超时。
测试不得依赖真实 NapCat 服务。tsdown 以 Node 平台输出 ESM 与类型声明。
