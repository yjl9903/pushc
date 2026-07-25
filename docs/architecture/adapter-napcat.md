# `@pushc/adapter-napcat`

## 定位与运行时

`packages/adapter-napcat` 直接导出继承 core `PushAdapter` 的 `NapCatAdapter` class。它依赖 `node-napcat-ts` 建立正向 WebSocket 连接，并依赖 `@pushc/core` 接入统一发送契约。constructor 的第二个 options 参数可注入 `factory`，以隔离 SDK 和真实 QQ 服务。

## 源码职责

| 文件               | 职责                                                       |
| ------------------ | ---------------------------------------------------------- |
| `src/adapter.ts`   | 组合配置、target、连接与发送操作，实现 core adapter 契约。 |
| `src/config.ts`    | 解析 WebSocket、token 与 timeout 连接配置。                |
| `src/target.ts`    | 解析 target partial，并校验私聊或群聊 ID。                 |
| `src/client.ts`    | 封装 SDK client 创建、惰性连接、复用、失败恢复与销毁。     |
| `src/operation.ts` | 管理单次连接/发送操作的取消、超时和 Promise 竞争。         |
| `src/error.ts`     | NapCat 错误码和错误类型。                                  |
| `src/types.ts`     | 公共配置、target、receipt、client 与注入类型。             |
| `src/index.ts`     | 公共 API 导出。                                            |

## Adapter 连接配置

`parseNapCatConfig` 只接受 snake_case 配置字段。camelCase 拼写和其他未知字段均返回 `INVALID_CONFIG`；实例公开的 `NapCatConfig` 和 `NapCatTargetConfig` 也使用 snake_case。

| 字段           | 规则与默认值                                    |
| -------------- | ----------------------------------------------- |
| `base_url`     | 必填，只允许 `ws:` 或 `wss:`，由 `URL` 标准化。 |
| `access_token` | 可选；trim 后的空字符串按未配置处理。           |
| `timeout_ms`   | 正安全整数，默认 10,000 ms。                    |

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

## 单次发送生命周期

NapCatAdapter 惰性维护单个 WebSocket client：constructor 与 `initialize` 不连接，第一次 `send` 调用 `factory` 并建立连接；并发的首次发送共享同一连接 Promise，后续发送复用已连接 client，直到 `destroy` 断开并终止 adapter。

1. 创建覆盖 lazy connect 和 send 的操作级 timeout，并监听调用方 signal 与 adapter destroy signal。
2. 获取或惰性建立共享 WebSocket 连接。
3. target 的 `user_id` 或 `group_id` 直接传给 SDK；payload 的 `message` 固定转换为一个
   NapCat text segment，本轮不支持的 `title` 与 `param` 被明确忽略。
4. 调用 `send_msg`；receipt request 记录 `{ method: 'send_msg', params }`，包括实际
   `user_id`/`group_id` 和消息段，response 将 `message_id` 转为 `{ messageId }`。
5. 成功 outcome 返回纯 receipt；summary 以自然语言记录 user/group、收件人 ID 和 message
   ID。连接、发送、超时和取消返回失败 outcome 与同一 request receipt；标准 Error 或 NapCat
   SDK failure object 的非空 string `message` 被保留，其他异常使用稳定回退描述。
   success/error 不写入 receipt。
6. 清理本次 signal/timeout；连接保留给后续发送。

`destroy` 幂等地取消进行中的等待并断开共享 client；断开连接失败由 lifecycle 调用方处理。连接建立失败会清除缓存，使后续发送可以重试。

## 错误与测试边界

`NapCatError` 使用 `INVALID_CONFIG` 和 `ABORTED`。请求形成后的 SDK、超时和取消错误转换为
失败 outcome；连接和 target 配置错误由 adapter send 边界转换为 `INVALID_CONFIG` outcome。

Vitest 通过注入 mock client 覆盖 target 默认字段、partial 继承、连接字段拒绝、同一账号的
私聊/群聊参数映射、连接参数、receipt、SDK failure object、稳定错误回退、失败清理、配置
校验和超时取消。测试不得依赖真实 NapCat 服务。tsdown 以 Node 平台输出 ESM 与类型声明。
