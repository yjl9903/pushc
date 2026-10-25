# Grok Bot adapter 接入方案

状态：调研完成，待实现。核对日期：2026-10-25。

## 背景与目标

新增 `@pushc/adapter-grok-bot`，CLI 配置类型为 `grok-bot`，导出 `GrokBotAdapter`。
调用方提供 Routine 的 webhook URL 和 key 即可发送消息；底层复用 webhook adapter 已有的
请求构造、JSON 序列化、Fetch、超时、取消、响应判断和 HTTP receipt。

本方案新增平台入口，不改变已有 webhook、NapCat 和 core 的行为，不需要迁移历史配置。
实施后现状架构文档必须同步更新；本计划不代表功能已经可用。

## 上游协议与证据

[Grok Bot 官方 Routines 文档](https://cursor.com/help/grok-bot/routines)明确说明：

- 在 Bot 中创建带 webhook trigger 的 Routine；桌面端详情提供 POST URL、key 和完整 header。
- 向该 URL 发送 POST，使用 `Authorization: Bearer <key>`，可以携带 JSON body。
- Bot 会同时收到 Routine instruction 和请求 body。
- HTTP 200 表示调用已接受、运行已启动；不表示任务完成，结果在 Bot 聊天和运行历史中查看。

文档没有规定业务 body schema，也没有承诺稳定的 response body schema。因此下文的
`message/title/param` 是 pushc 定义的输入约定；成功判断只固定为 HTTP 200，不要求
`success`、`runUuid`、`backgroundComposerId` 等 response body 字段。

[Grok Automations 的签名文档](https://docs.x.ai/grok/automations/webhooks)描述另一套
Standard Webhooks / HMAC 接口，不能用于本 adapter。这里不实现 HMAC，不使用 xAI 模型 API key，
也不从 bot ID 或 routine ID 推导 endpoint。始终使用应用提供的完整 URL 和对应 key。

## 现有实现与复用方式

已核对 `docs/architecture/`、core 的 `PushAdapter`、webhook 配置/发送实现及测试，以及
CLI 的 adapter 构造和配置测试。现有能力足够完成传输，但复用函数尚未从 package root 导出。

推荐依赖关系：

```text
apps/pushc
  -> @pushc/adapter-grok-bot
       -> @pushc/adapter-webhook
            -> @pushc/core
       -> @pushc/core
```

`GrokBotAdapter` 直接继承 core 的 `PushAdapter`，以函数组合复用 webhook。将已有
`src/request.ts` 中的以下符号从 `@pushc/adapter-webhook` package root 显式导出：

- `buildWebhookRequest`
- `sendWebhook`
- `WebhookDispatchPlan`（type）

已有 `parseWebhookConfig`、receipt types 和 `WebhookError` 已公开，可直接复用。
两个 adapter 调用同一套实现；不复制 Fetch、serializer 或 response evaluator，不增加通用
HTTP 基类、preset registry 或 transport 插件机制。新增导出的函数接收已验证的配置和
normalized payload，文档明确它们不代替 core 的公共发送边界。

不直接继承 `WebhookAdapter`：它的 public `config` 和 target 类型绑定了通用 webhook
schema，且 transport 字段为私有字段。强行继承会让 Grok 配置和回执类型产生歧义。
也不在 Grok 的 hooks 中调用另一个 adapter 的 `send()`：这会再次 normalize 消息、渲染模板，
并引入第二次 target 解析和 receipt 组装。

## 配置与 target

建议公开配置：

```ts
interface GrokBotConfig {
  readonly url: string;
  readonly key: string;
  readonly timeout_ms: number;
}

interface CreateGrokBotAdapterOptions {
  readonly fetch?: typeof globalThis.fetch;
}
```

constructor 接受 `unknown` 并严格验证；输入 `timeout_ms` 可省略，resolved config 中为
webhook 的默认 10000。使用 webhook parser 校验 URL、超时并取得规范化值；额外要求
Grok endpoint 为 HTTPS。URL 不允许模板和内嵌 credentials，不硬编码服务域名或路径。
key 为原始非空 token，不接受 `Bearer ` 前缀、空白/control character 或模板表达式。
校验错误不回显 URL、key 或输入对象。

每个实例有一个必填的默认 URL/key；无需 target 即可发送。具名或临时 target 接受：

- `timeout_ms`：可独立覆盖。
- `url` 和 `key`：替换 Routine 时必须一起提供，作为一组替换默认连接信息。
  URL 必须与 adapter 的默认 URL 同 origin，保留 webhook 的 origin 限制。
- 空 target 继承默认配置；未知字段拒绝。不开放 `request`、`response` 或任意 headers/body。

在 target 解析阶段检查 URL/key 配对和 origin，使 `targets` 及注册阶段即可发现错误。
不同 origin 使用不同 adapter 实例。target 不支持单独替换 key；轮换时更新对应配置中的 key，
具名 target 保留其原 URL 即可。

```toml
[adapters.grok]
type = "grok-bot"
url = "${GROK_BOT_WEBHOOK_URL}"
key = "${GROK_BOT_WEBHOOK_KEY}"
# timeout_ms = 10000

[adapters.grok.targets.research]
url = "${GROK_RESEARCH_WEBHOOK_URL}"
key = "${GROK_RESEARCH_WEBHOOK_KEY}"
```

CLI 沿用相邻 `.env` / 进程环境注入和脱敏，不增加专属环境变量读取逻辑。仓库只保存引用和
占位示例，不保存真实 endpoint、key 或 `.env`。

## 消息映射

固定发送 JSON object：

```json
{
  "message": "core 渲染后的全部 text node 按顺序无分隔符拼接",
  "title": "调用方提供的标题",
  "param": { "event": "build.completed" }
}
```

- `message` 必有，使用 webhook 原有的 `{{message}}` 拼接语义。
- `title` 未提供时省略；显式空字符串保留，不自动补标题。
- `param` 未提供时省略；提供时把完整 string Map 转为同名 JSON object，空 Map 为 `{}`。
  key 保持一层，不把 `a.b` 展开成嵌套对象，不把字符串解析成数字或 JSON。
- 附件返回 `INVALID_MESSAGE`，不上传、不忽略，也不把附件 source 当消息发送。
- `event` 等业务字段放在 `param` 中；首版不提供任意 body 模板或自定义字段覆盖。

为避免二次模板渲染，传给 webhook builder 的 body 使用固定占位模板：
`message: '{{message}}'`、按存在性加入 `title: '{{title}}'`，并对每个 param key 生成
`'{{param.<key>}}'`。不要把 normalized message、title 或 param 的实际值先写入 body
再交给 template renderer。webhook scanner 的 replacement 不递归，实际值中的 `{{...}}`
因此能够保持字面内容。

用户为 Routine 配置的 instruction 应明确该 envelope 的字段含义。例如接收 `message`
作为本次任务描述、`title` 作为标签、`param` 作为额外上下文，结果回复到所属 Bot 的聊天。

## 发送流程、回执与错误

1. core 完成 payload/options 校验、一次 content 渲染、target resolve 和预取消检查。
2. Grok `prepareRequest` 拒绝附件，将 resolved Grok 配置转换成 webhook 配置：固定 POST、
   `application/json`、Bearer header、上述 body 模板、timeout 和 `response.status = 200`。
3. 通过 `parseWebhookConfig` 和 `buildWebhookRequest` 生成标准 HTTP receipt request；
   builder 的 origin 参数来自 adapter 默认 URL，不能改成 target origin 来绕开限制。
4. 返回 `{ receiptRequest, transportRequest: { request, responsePolicy } }`。
   core 的 dry-run 在此结束，不创建网络请求或执行 Bot。
5. `dispatchRequest` 调用 `sendWebhook`，传入注入的 Fetch、dispatch plan 和原 options。
   成功时仅把 summary 改成 `Grok Bot routine triggered (HTTP 200).`。
6. core 组装最终 receipt。失败保留 webhook 的 HTTP response 和错误分类；配置错误统一转成
   `PushError('INVALID_CONFIG', 'Invalid Grok Bot configuration.')`，cause 不进入公开结果。

复用 `WebhookRequestReceipt` / `WebhookResponseReceipt`，不制造未经官方定义的 Grok run
类型。Node 库 receipt 与 webhook 一样包含真实请求内容，CLI 使用既有的配置脱敏规则。
不新增 result 顶层字段，不轮询任务结果，不自动重试。网络超时可能发生在服务已接受请求之后，
调用方重发可能产生第二次运行；首版不声称 exactly-once 或服务端幂等。

## 改动范围

| 位置 | 改动 |
| --- | --- |
| `packages/adapter-webhook/src/index.ts` | 显式导出既有请求函数和 dispatch plan type |
| `packages/adapter-grok-bot/` | 新 workspace、配置/types、adapter、README、mock tests |
| `apps/pushc/src/client.ts` | 增加 `grok-bot` constructor 分支 |
| `apps/pushc/package.json`、lockfile | 新 workspace 依赖 |
| 根 `tsconfig.json` | 新包的 source path mapping |
| CLI tests | 构造、targets、环境变量、dry-run、脱敏、错误退出 |
| `docs/architecture/adapter-grok-bot.md` | 新平台配置、映射、成功语义和错误边界 |
| 架构总览、webhook 与 CLI 架构 | 更新 adapter 间依赖和新增公共复用接口 |
| CLI README、`skills/pushc` 的配置参考/示例 | 新类型和 Routine 配置用法 |

新包采用现有 runtime-neutral workspace 的 ESM、构建和声明输出方式；不引入 Node API。
实施时检查构建、发布 workflow 是否有包列表需要补齐；不为本功能调整现有 pipeline 策略。
现有架构与实现未发现阻止此方案的冲突；新增 adapter 间的单向依赖需在架构总览中明确记录。

## 验证与完成标准

- 使用注入 Fetch 检查实际 URL、Bearer header、POST、JSON 字节和 timeout/signal 行为。
- 默认、具名和临时 target；URL/key 配对、同 origin、超时覆盖、未知字段拒绝。
- 多 text node、引号/换行、缺省/空 title、缺省/空 param、点号 key；正文和 param 值中的
  字面 `{{...}}` 不被再次展开；附件在 Fetch 之前失败。
- HTTP 200 成功；201/202/204、401/429/500 均失败；200 空 body 可成功，响应 JSON 只记录。
- dry-run 无 Fetch、预取消无 Fetch、发送中取消/超时保留 receipt；并发发送不串 key 或 body。
- CLI 新类型、具名 target、环境变量展开、dry-run 输出和错误路径均不泄露配置中的 URL/key。
- 原 webhook 测试继续通过，确认新增 exports 没有改变通用请求行为。
- 实施后运行 typecheck、CI tests 和 build，使用 mock 而不依赖真实 Grok Routine。

本轮仅产出方案；尚未创建或触发真实 Routine，也未验证实际账户的响应 body。
