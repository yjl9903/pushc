# `@pushc/adapter-webhook`

## 定位与运行时

`packages/adapter-webhook` 提供高自由度的通用 HTTP webhook adapter，不承载 Bark、ntfy、
Gotify 或 Pushover 的产品语义。它依赖 `@pushc/core` 与 Zod，使用标准 `fetch`、`Headers`、
`URL` 和 `AbortSignal`，不依赖 Node API。测试或非标准运行时可以注入 fetch。

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
| `timeout_ms`   | `10000`                        | `1..2_147_483_647` 的整数                                   |
| `body`         | 无                             | JSON value 或 string，不自动生成默认 body                   |

旧平铺 request 字段和其他未知字段为 `INVALID_CONFIG`，不提供兼容层。

target request 标量整体覆盖。headers 在每层先按 lowercase name 校验去重，再用普通 object
浅合并；target winner。只有两层 body 都是 JSON object 时按 top-level key 浅合并，
其他情况 target body 整体替换。`body: null` 是显式合法 body。resolved target 是新建的
`{ request, response }` 只读配置对象；headers 使用普通 object copy。发送时的模板渲染会
从 resolved body 建立独立 JSON tree，不修改配置对象。

JSON body 只校验为类型定义描述的 JSON-shaped value，其中 object 必须是普通 object 或
null-prototype object；不额外深拷贝。TOML datetime 是 parser 标量而非 JSON object，
因此作为 body 或嵌套 body value 时为 `INVALID_CONFIG`。调用方负责提供普通 JSON 数据，
不为 bigint、undefined、symbol、function、循环结构等越界输入增加转换或专项错误语义。

`src/utils/json.ts` 集中维护 JSON value/object 识别；`src/utils/record.ts` 只维护 record
shape 识别。二者是内部纯工具，不从 package root 导出；配置解析、请求构造和发送生命周期仍
留在对应领域模块。

## 模板

可用变量是 `{{message}}`、`{{title}}` 和 `{{param.key}}`，并支持
`{{variable:-fallback}}`。变量缺失或值为 `''` 时使用 fallback；无 fallback 时输出空 string。
expression 外围 ASCII whitespace 被忽略，fallback 按第一个 `:-` 分隔且保持字面内容。
`param.key` 的运行时查询结果只有 string 才算存在；普通 object 原型链上的同名非 string
成员按缺失处理。

scanner 从左到右只扫描一次，replacement 与 fallback 不递归。非法、未知或未闭合 expression
原样保留。`\{{...}}` 消费紧邻起始符的一个反斜杠并输出字面模板。

顶层静态 URL 不渲染；adapter/target 的 `request.url` 可渲染。header 只渲染 value；body
递归渲染 string value，不渲染 object key 或非 string value。模板不做 URL/JSON encoding。

## Request 构造

异步 `prepareRequest(target, payload)` 将 normalized payload 的 text nodes 无分隔符拼接为
模板变量 `message`，并拒绝任何 attachment node，再从 `target.request` 每次建立独立的
Headers 与 JSON tree：

1. 渲染 request URL、header value 和 body string value。
2. 校验最终绝对 HTTP(S) URL、credentials 与 adapter origin。
3. body 存在时解析 `content_type`，选择 JSON 或 text serializer；text 要求 string body。
4. body 存在且无显式 Content-Type 时自动写入；显式 header 必须是支持值且 essence 一致。
5. body 不存在时省略 Fetch body，不自动生成或解析 Content-Type。
6. 最终 header value 由 `new Headers([...map])` 校验。
7. GET/HEAD 只允许 body 为 `undefined`。
8. `WebhookRequest` 携带 resolved `timeout_ms`；`dispatchRequest` 通过标准
   `AbortSignal.timeout()` 与 `AbortSignal.any()` 组合 timeout 和 parent signal，再调用 Fetch。

preparation 返回同一个规范化 request 作为 `receiptRequest` 与 `transportRequest`。
`send(..., { dryRun: true })` 只执行本地 preparation，返回只含最终 request 的 receipt，不创建
timeout 或调用 Fetch。正常 send 将 prepared request 传给 `dispatchRequest`，因此 dry run 与
receipt request 不维护重复转换逻辑。Webhook 不支持 attachment nodes，统一返回
`INVALID_MESSAGE`，不静默忽略或隐式生成 multipart。

Webhook 以 `response.ok`（HTTP 200–299）判断成功，不增加 retry。dispatch 返回 response、
summary 或 error，由 core 统一组装 receipt。receipt request
记录最终 URL、method、经 `Headers` 规范化后的 headers、content type、timeout 和渲染后的
body；Fetch 使用同一份规范化 header record，JSON body 保留序列化前的 `JsonValue`，实际
Fetch body 从同一值生成。response 记录 status、过滤常见鉴权字段后的 headers，并 best-effort
解析 JSON body。成功 summary 记录 method、最终 URL 的 host 和 HTTP status。非 2xx、
timeout、取消和 transport error 在请求形成后返回包含 receipt 的失败 result。

## 错误边界

配置与 send-time request 构造错误使用 sanitized `WebhookError('INVALID_CONFIG')`，保留
cause，不在 public message 中包含 URL、header 或 body。`parseTarget` 和 `prepareRequest`
分别将该错误映射为 `PushError('INVALID_CONFIG')`，确保 adapter、client 与 CLI 一致。
transport、HTTP 和 abort 错误转换为统一失败 result，不做配置错误映射。

## 测试边界

测试覆盖配置默认矩阵、target merge、JSON normalization、模板 scanner、URL origin、
Content-Type/serializer、method/body、timeout/abort、并发请求隔离、错误映射、
多个 text node 拼接、attachment 明确拒绝、严格空 response 占位、dry run 无 Fetch、
response receipt。
