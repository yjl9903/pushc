# `@pushc/adapter-grok-bot`

## 定位与依赖

`GrokBotAdapter` 直接继承 core 的 `PushAdapter`，提供 Grok Bot Routine webhook 入口。
它依赖 core、Zod 和 `@pushc/adapter-webhook`，保持 runtime-neutral ESM；不使用 Node API。
CLI 配置类型为 `grok-bot`。constructor 接受 unknown 配置与可选 `{ fetch }` 测试注入。

请求构造、模板、JSON/text serializer、Fetch、超时、取消、响应策略和 HTTP receipt 全部复用
webhook。没有第二个 adapter.send、重复 normalize 或独立 transport 实现。Webhook package
root 的 `buildWebhookRequest`、`sendWebhook` 和 `WebhookDispatchPlan` 是复用边界。

## 配置与 target

公开的 resolved `GrokBotConfig` 包含 `url`、`key`、`timeout_ms`、`content_type` 和可选
`body`；config 与 resolved target 使用同一类型。

- `url` 必填：应用提供的完整 HTTPS URL，使用 webhook parser 规范化；拒绝 credentials
  与模板。不固定域名、不从 ID 推导 URL。
- `key` 必填：原始非空 token，不接受 Bearer 前缀、空白/control character 或模板。
- `timeout_ms` 默认 10000；沿用 webhook 的整数范围。
- `content_type` 默认 `application/json`；支持 JSON/text 与可选 UTF-8 charset。
- `body` 可省略，显式值允许 webhook 支持的任意 JSON value，无业务 schema 限制。
  text/plain 要求 string。JSON-shaped value 与编码校验由 webhook 完成。
- 拒绝未知配置字段；body 内业务字段不受此限制。

无 target 使用默认连接；空 target 继承全部配置。具名/临时 target 可独立覆盖
`timeout_ms`、`content_type`、`body`。替换 Routine 必须同时提供 `url` 与 `key`，URL
必须与 adapter 默认 URL 同 origin。这些约束在 parseTarget 中检查，注册与 CLI targets
阶段即可报错。不同 origin 使用不同实例；轮换具名 target 的 key 时保留其 URL。

通过 `parseWebhookTargetPartial` / `resolveWebhookTarget` 合并显式 body：两层都为 object
时按顶层 key 浅合并，嵌套 object 整体覆盖；其他值整体替换。null 是显式值。空 object
参与浅合并，不具有清空继承字段的专用语义。合并后才生成缺省 body。

## 消息映射与模板

未配置 body 时，JSON 请求自动生成 `message`，以及按存在性加入的 `title` 与 `param`。
message 是 core 已渲染的全部 text node 无分隔符拼接；缺省 title/param 省略，空 title
保留为空 string，空 param Map 保留为 `{}`。param 保持一层 string object，不展开点号 key，
不解析 string 中的数字或 JSON。text/plain 未配置 body 时直接使用消息文本。

默认 body 使用 `{{message}}`、`{{title}}` 和逐 key 的 `{{param.<key>}}` 模板，不能先写入
payload 的实际值再渲染。core 的 param key 校验保证这些表达式有效；webhook scanner 对
replacement 不递归，因此实际值中的 `{{...}}` 保持字面内容。

显式 `{}`、`[]`、`""`、false、0、null 均不会触发默认 body；自定义 body 不混入
message/title/param 字段。自定义模板完全沿用 webhook 的递归 string value 渲染、fallback、
转义和非 string 值保留规则；不渲染 object key、不隐式解析 JSON string。JSON string 根节点
会带 JSON 引号编码，原样文本须选择 text/plain。

core 仍要求有效 content。无论自定义 body 是否引用消息，任何 attachment 都在 Fetch 前返回
`INVALID_MESSAGE`。文本模式是传输能力，尚未用真实 Routine 验证其接受情况。

## 发送、成功语义与错误

prepareRequest 固定 POST、`Authorization: Bearer <key>`、HTTP status 200 策略，通过
`parseWebhookConfig` 与 `buildWebhookRequest` 产生 HTTP request 和 dispatch plan。
builder 的 origin 始终取自 adapter 默认 URL。dry-run 在本地 preparation 后结束，不调用
Fetch、不创建 timeout，也不触发 Routine。

dispatchRequest 直接调用 `sendWebhook`，成功 summary 为
`Grok Bot routine triggered (HTTP 200).`。HTTP 200 只表示 Routine 触发成功，不表示任务
完成；201/202/204 同样判失败。响应 JSON 仅记录，不检查 success/run ID 等未定义字段，
200 空 body 也成功。没有轮询、重试、HMAC 或 xAI 模型 API 集成。

复用 `WebhookRequestReceipt` / `WebhookResponseReceipt`。HTTP、网络、取消与超时失败
保持 webhook 的分类和已形成的 receipt；Grok 配置错误统一为
`PushError('INVALID_CONFIG', 'Invalid Grok Bot configuration.')`，cause 不进入公开结果。
Node 库返回完整请求，CLI 使用既有配置脱敏机制。超时可能发生在服务已经接受请求之后，
手动重发可能启动第二次运行，不承诺幂等。

## 验证

mock Fetch 覆盖默认/具名/临时 target、连接校验、body merge 与所有 JSON 类型、模板只替换
一次、text/plain、成功策略、dry-run、预取消、发送中取消、超时、网络错误和并发隔离。
CLI 测试覆盖环境变量展开、构造、targets、dry-run 脱敏、HTTP 失败与错误退出码。
不发送真实 Grok webhook、不读取或保存真实连接信息。
