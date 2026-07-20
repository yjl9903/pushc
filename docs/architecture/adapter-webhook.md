# `@pushc/adapter-webhook`

## 定位与运行时

`packages/adapter-webhook` 直接导出继承 core `PushAdapter` 的 `WebhookAdapter` class。它只依赖 `@pushc/core`，使用标准 `fetch`、`Headers`、`URL` 和 `AbortController`，构建目标为 neutral。运行时必须提供这些 Web API；测试或非标准运行时可通过 constructor 第二个 options 参数注入 `fetch`。

## 源码职责

| 文件 | 职责 |
| --- | --- |
| `src/adapter.ts` | 组合配置、target 与发送能力，实现 core adapter 契约。 |
| `src/config.ts` | 解析连接级 URL、method、headers 与 timeout。 |
| `src/target.ts` | 解析 target partial、校验 JSON body 并渲染消息模板。 |
| `src/request.ts` | 构造 HTTP 请求，管理取消、超时、响应与 receipt。 |
| `src/error.ts` | Webhook 错误码和错误类型。 |
| `src/types.ts` | 公共配置、target、receipt 与注入选项类型。 |
| `src/index.ts` | 公共 API 导出。 |

## Adapter 连接配置

`parseWebhookConfig` 只接受 snake_case 配置字段。camelCase 拼写和其他未知字段均返回 `INVALID_CONFIG`；实例公开的 `WebhookConfig` 和 `WebhookTargetConfig` 也使用 snake_case。

| 字段                       | 规则与默认值                                        |
| -------------------------- | --------------------------------------------------- |
| `url`                      | 必填，只允许 `http:` 或 `https:`，由 `URL` 标准化。 |
| `method`                   | 默认 `POST`，trim 后转为大写。                      |
| `headers`                  | 可选对象，所有值必须是字符串。                      |
| `timeout_ms`               | 正安全整数，默认 10,000 ms。                        |

URL、鉴权 header 等连接信息只在 adapter 实例创建时解析一次，可供多个 target 复用。

## Target 配置

adapter 顶层的 `body_mode` 与 `body` 由 `WebhookAdapter` 私有保存为 target 默认字段。`parseTarget` 只允许 partial 包含这两个 snake_case 字段，执行顶层浅合并后调用 `parseWebhookTarget`；URL、method、headers、timeout 及未知字段均被拒绝。发送时省略 target 会传入空 partial 生成 default；对象 target 会作为匿名临时 partial 解析，两者都不进入 registry。

`parseWebhookTarget` 输出 `WebhookTargetConfig`：

| 字段                     | 规则与默认值                                                            |
| ------------------------ | ----------------------------------------------------------------------- |
| `body_mode`              | `json`（默认）或 `text`。                                               |
| `body`                   | JSON 模式默认 `{ text: "{{message}}" }`；文本模式默认 `"{{message}}"`。 |

JSON body 只接受可编码的有限数字、字符串、布尔值、null、数组和对象。TOML bigint 仅在 JSON 安全整数范围内转换为 number。文本模式要求 body 为字符串。

## 发送流程

1. 组合调用方 signal 与 adapter 实例的请求超时。
2. 在 target body 的所有字符串值中递归替换每个 `{{message}}`；对象键不参与替换。
3. JSON 模式执行 `JSON.stringify`，文本模式直接发送字符串。
4. 仅在连接配置未提供时设置 `content-type`：JSON 使用 `application/json`，文本使用 `text/plain; charset=utf-8`。
5. 使用实例的 URL、method、headers 与 target body 调用 fetch。
6. 仅 `response.ok` 视为成功，并返回 `{ status, statusText }`。
7. 清理 timeout 与父 signal listener。

父 signal 取消和超时都产生 `ABORTED`；超时错误消息包含配置的毫秒数。

## 错误与测试边界

`WebhookError` 使用 `INVALID_CONFIG`、`FETCH_UNAVAILABLE`、`HTTP_ERROR`、`ABORTED` 四类错误码；HTTP 错误额外携带 status。未归类的 fetch 异常由 adapter 抛出，随后由 core 归一化为 `SEND_FAILED`。

Vitest 使用注入的 fetch 覆盖 target 默认字段、partial 浅合并、连接字段拒绝、JSON 递归模板、文本 body、自定义 content type、配置校验、非成功状态与超时，不依赖真实网络。tsdown 输出 neutral ESM 与类型声明。
