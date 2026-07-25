# `@pushc/adapter-webhook`

## 定位与运行时

`packages/adapter-webhook` 提供高自由度的通用 HTTP webhook adapter，不承载 Bark、ntfy、
Gotify 或 Pushover 的产品语义。它依赖 `@pushc/core` 与 Zod，使用标准 `fetch`、`Headers`、
`URL` 和 `AbortController`，不依赖 Node API。测试或非标准运行时可以注入 fetch。

## 配置与 resolved target

adapter 顶层只接受：

- `url`：必填静态绝对 HTTP(S) URL。初始化时标准化，禁止 credentials 与 `{{`，并保存
  static origin。
- `request`：可选 HTTP request 配置 table。
- `response`：可选空 table，为后续 response parser 预留；本阶段不执行任何行为，非空即
  `INVALID_CONFIG`。

adapter 与 target 的 `request` 使用相同的 snake_case 字段；target 顶层只接受
`request`/`response` partial：

| request 字段   | 默认值                         | 规则                                                        |
| -------------- | ------------------------------ | ----------------------------------------------------------- |
| `url`          | adapter 顶层 `url`             | 可含模板；最终必须是与静态 URL 同 origin 的绝对 HTTP(S) URL |
| `method`       | `POST`                         | trim、转大写、满足 HTTP token，拒绝 CONNECT/TRACE/TRACK     |
| `headers`      | 空                             | string table，name 大小写不敏感                             |
| `content_type` | body 存在时 `application/json` | 仅支持 JSON/text 与可选 UTF-8 charset                       |
| `timeout_ms`   | `10000`                        | `1..2_147_483_647` 的整数或同范围 bigint                    |
| `body`         | 无                             | JSON value 或 string，不自动生成默认 body                   |

旧平铺 request 字段和其他未知字段为 `INVALID_CONFIG`，不提供兼容层。

target request 标量整体覆盖。headers 在每层先按 lowercase name 校验去重，再用局部 Map
浅合并；target winner。只有两层 body 都是 plain JSON object 时按 top-level key 浅合并，
其他情况 target body 整体替换。字段存在性使用 own-property 判断，所以 `body: null` 是
显式合法 body。resolved target 是新建的 `{ request, response }` 只读配置对象；headers 和
JSON object 物化为 null-prototype copy。

JSON body 通过带 replacer 的 `JSON.stringify` 与 `JSON.parse` 标准化。只接受 JSON-shaped
value；safe bigint 转 number，拒绝非 finite number、unsafe bigint、undefined、symbol、
function 与循环结构。

`src/utils/json.ts` 集中维护 JSON value 识别、深拷贝和 null-prototype 转换；
`src/utils/record.ts` 集中维护 plain record 识别及 Map 到安全 record 的物化。二者是内部
纯工具，不从 package root 导出；配置解析、请求构造和发送生命周期仍留在对应领域模块。

## 模板

可用变量是 `{{message}}`、`{{title}}` 和 `{{param.key}}`，并支持
`{{variable:-fallback}}`。变量缺失或值为 `''` 时使用 fallback；无 fallback 时输出空 string。
expression 外围 ASCII whitespace 被忽略，fallback 按第一个 `:-` 分隔且保持字面内容。

scanner 从左到右只扫描一次，replacement 与 fallback 不递归。非法、未知或未闭合 expression
原样保留。`\{{...}}` 消费紧邻起始符的一个反斜杠并输出字面模板。

顶层静态 URL 不渲染；adapter/target 的 `request.url` 可渲染。header 只渲染 value；body
递归渲染 string value，不渲染 object key 或非 string value。模板不做 URL/JSON encoding。

## Request 构造

`sendTarget(target, payload, options)` 从 `target.request` 每次建立 request-local headers
Map 与 JSON tree：

1. 渲染 request URL、header value 和 body string value。
2. 校验最终绝对 HTTP(S) URL、credentials 与 adapter origin。
3. body 存在时解析 `content_type`，选择 JSON 或 text serializer；text 要求 string body。
4. body 存在且无显式 Content-Type 时自动写入；显式 header 必须是支持值且 essence 一致。
5. body 不存在时省略 Fetch body，不自动生成或解析 Content-Type。
6. 最终 header value 由 `new Headers([...map])` 校验。
7. GET/HEAD 只允许 body 为 `undefined`。
8. `WebhookRequest` 携带 resolved `timeout_ms`；请求构造完成后才由发送函数启动 timeout，
   组合 parent signal 并调用 Fetch；所有出口清理 timer/listener。

Webhook 以 `response.ok`（HTTP 200–299）判断成功，不增加 retry。统一 receipt request
记录最终 URL、method、经 `Headers` 规范化后的 headers、content type、timeout 和渲染后的
body；Fetch 使用同一份规范化 header record，JSON body 保留序列化前的 `JsonValue`，实际
Fetch body 从同一值生成。response 记录 status、过滤常见鉴权字段后的 headers，并 best-effort
解析 JSON body。成功 summary 记录 method、最终 URL 的 host 和 HTTP status。非 2xx、Fetch
不可用、timeout、取消和 transport error 在请求形成后返回包含 receipt 的失败 outcome。

## 错误边界

配置与 send-time request 构造错误使用 sanitized `WebhookError('INVALID_CONFIG')`，保留
cause，不在 public message 中包含 URL、header 或 body。`parseTarget` 和 `sendTarget`
分别将该错误映射为 `PushError('INVALID_CONFIG')`，确保 adapter、client 与 CLI 一致。
transport、HTTP 和 abort 错误转换为统一失败 outcome，不做配置错误映射。

## 测试边界

测试覆盖配置默认矩阵、target merge、特殊 key、JSON normalization、模板 scanner、URL
origin、Content-Type/serializer、method/body、timeout/abort cleanup、并发请求隔离、错误映射、
严格空 response 占位、response receipt 与 fetch unavailable。
