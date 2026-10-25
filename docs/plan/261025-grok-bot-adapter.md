# Grok Bot adapter 接入方案

状态：已实现并验证（2026-10-26）。协议核对日期：2026-10-25；方案更新日期：2026-10-26。

## 背景与目标

新增 `@pushc/adapter-grok-bot`，CLI 配置类型为 `grok-bot`，导出 `GrokBotAdapter`。
调用方提供 Routine 的 webhook URL 和 key 即可发送消息；底层复用 webhook adapter 已有的
请求构造、JSON 序列化、Fetch、超时、取消、响应判断和 HTTP receipt。

本方案新增平台入口，不改变已有 webhook、NapCat 和 core 的行为，不需要迁移历史配置。
实现与现状架构文档已同步；当前行为以 `docs/architecture/adapter-grok-bot.md` 为准。

## 上游协议与证据

[Grok Bot 官方 Routines 文档](https://cursor.com/help/grok-bot/routines)明确说明：

- 在 Bot 中创建带 webhook trigger 的 Routine；桌面端详情提供 POST URL、key 和完整 header。
- 向该 URL 发送 POST，使用 `Authorization: Bearer <key>`，可以携带 JSON body。
- Bot 会同时收到 Routine instruction 和请求 body。
- HTTP 200 表示调用已接受、运行已启动；不表示任务完成，结果在 Bot 聊天和运行历史中查看。

文档没有规定业务 body schema，也没有承诺稳定的 response body schema。因此 adapter 不增加
业务 body schema 限制；下文的 `message/title/param` 仅为未配置 body 时的便利默认值，
调用方可以完全自定义。成功判断只固定为 HTTP 200，不要求
`success`、`runUuid`、`backgroundComposerId` 等 response body 字段。

[Grok Automations 的签名文档](https://docs.x.ai/grok/automations/webhooks)描述另一套
Standard Webhooks / HMAC 接口，不能用于本 adapter。这里不实现 HMAC，不使用 xAI 模型 API key，
也不从 bot ID 或 routine ID 推导 endpoint。始终使用应用提供的完整 URL 和对应 key。

## 现有实现与复用方式

已核对 `docs/architecture/`、core 的 `PushAdapter`、webhook 配置/发送实现及测试，以及
CLI 的 adapter 构造和配置测试。现有能力足够完成传输；本次已将复用函数从 package root 导出。

实现后的依赖关系：

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

已有 `parseWebhookConfig`、`parseWebhookTargetPartial`、`resolveWebhookTarget`、`JsonValue`、
receipt types 和 `WebhookError` 已公开，可直接复用，包括 body 校验和 target 合并规则。
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
  readonly content_type: string;
  readonly body?: JsonValue;
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

`body` 接受 webhook 支持的任意 JSON value，包括 object、array、string、number、boolean
和 null，不要求特定字段或 object 根节点。`content_type` 默认 `application/json`，支持范围
和编码校验沿用 webhook，也可以显式使用 `text/plain` 发送 string body。文本模式属于底层
传输能力，实际 Routine 是否接受由上游响应决定，不声称已通过真实服务验证。

每个实例有一个必填的默认 URL/key；无需 target 即可发送。具名或临时 target 接受：

- `timeout_ms`：可独立覆盖。
- `body`、`content_type`：可独立覆盖；body 合并规则直接复用 webhook，两个显式 body
  都是 object 时按顶层 key 浅合并，其余整体替换。嵌套对象不深合并，null 是显式值。
- `url` 和 `key`：替换 Routine 时必须一起提供，作为一组替换默认连接信息。
  URL 必须与 adapter 的默认 URL 同 origin，保留 webhook 的 origin 限制。
- 空 target 继承默认配置；未知配置字段拒绝，但不限制 body 内的业务字段。

在 target 解析阶段检查 URL/key 配对和 origin，使 `targets` 及注册阶段即可发现错误。
不同 origin 使用不同 adapter 实例。target 不支持单独替换 key；轮换时更新对应配置中的 key，
具名 target 保留其原 URL 即可。

```toml
[adapters.grok]
type = "grok-bot"
url = "${GROK_BOT_WEBHOOK_URL}"
key = "${GROK_BOT_WEBHOOK_KEY}"
# timeout_ms = 10000

[adapters.grok.body]
task = "{{message}}"
subject = "{{title}}"
event = "{{param.event:-notification}}"
metadata = { source = "pushc", priority = 1 }
```

CLI 沿用相邻 `.env` / 进程环境注入和脱敏，不增加专属环境变量读取逻辑。仓库只保存引用和
占位示例，不保存真实 endpoint、key 或 `.env`。

## 默认 body 与自定义 body

只有 adapter 和 target 均未配置 body 时，才生成以下默认 JSON object：

```json
{
  "message": "core 渲染后的全部 text node 按顺序无分隔符拼接",
  "title": "调用方提供的标题",
  "param": { "event": "build.completed" }
}
```

- 默认 body 的 `message` 必有，使用 webhook 原有的 `{{message}}` 拼接语义。
- `title` 未提供时省略；显式空字符串保留，不自动补标题。
- `param` 未提供时省略；提供时把完整 string Map 转为同名 JSON object，空 Map 为 `{}`。
  key 保持一层，不把 `a.b` 展开成嵌套对象，不把字符串解析成数字或 JSON。
- 附件返回 `INVALID_MESSAGE`，不上传、不忽略，也不把附件 source 当消息发送。
- 自定义 body 可以把 `event` 等业务字段放在任意层级，也可以完全不含
  `message/title/param`。不自动追加、保留或覆盖这三个字段。

先通过 webhook resolver 合并 adapter/target 显式配置的 body，再判断是否需要默认值；
默认 envelope 不参与 object merge。例如 adapter 未配置 body、target 配置 `{ task =
"{{message}}" }`，最终只有 `task`，不会混入默认字段。显式 `{}`、`[]`、`""`、`false`、`0`
和 null 均不得触发默认值。显式 object body 之间的 `{}` 仍遵循 webhook 的浅合并语义，
不额外引入删除字段或清空继承的专用操作。TOML 无 null 字面量，null 可由库 API 的配置或
临时 target 提供。

自定义 body 直接使用 webhook 的模板能力：递归渲染 string value，支持 `{{message}}`、
`{{title}}`、`{{param.key}}`、fallback 和转义；不渲染 key，不改变 number/boolean/null，
也不把替换后的 string 隐式解析为 JSON。JSON string 根节点正常编码为 JSON string；
需要原样文本时显式使用 `content_type = "text/plain"`。文本模式未配置 body 时以
`"{{message}}"` 为默认 body。

为避免二次模板渲染，生成默认 body 时使用占位模板：
`message: '{{message}}'`、按存在性加入 `title: '{{title}}'`，并对每个 param key 生成
`'{{param.<key>}}'`。不要把 normalized message、title 或 param 的实际值先写入 body
再交给 template renderer。webhook scanner 的 replacement 不递归，实际值中的 `{{...}}`
因此能够保持字面内容。

用户为 Routine 配置的 instruction 应与最终 body 对应；自定义 body 的字段和结构由调用方
与 Routine 约定，adapter 不校验其业务含义。core 的公共 payload 校验保持原样：发送调用仍需
提供有效 content；自定义 body 可以选择不引用该 content。

## 发送流程、回执与错误

1. core 完成 payload/options 校验、一次 content 渲染、target resolve 和预取消检查。
2. Grok `prepareRequest` 拒绝附件，将 resolved Grok 配置转换成 webhook 配置：固定 POST、
   Bearer header 和 `response.status = 200`，沿用配置的 content type、timeout 和 body。
   仅当没有显式 body 时按 content type 生成上述默认 body。
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
- 任意字段/嵌套 body、array 和所有 JSON 标量；显式空值不触发默认值，自定义 body 不混入
  默认字段；adapter/target object 浅合并、非 object 整体替换和嵌套对象整体覆盖。
- 自定义模板、fallback、转义、非 string 保持类型；JSON string 与 text/plain 的编码区别；
  text/plain 默认消息和显式 body；非法 JSON-shaped value 或编码不匹配沿用 webhook 报错。
- HTTP 200 成功；201/202/204、401/429/500 均失败；200 空 body 可成功，响应 JSON 只记录。
- dry-run 无 Fetch、预取消无 Fetch、发送中取消/超时保留 receipt；并发发送不串 key 或 body。
- CLI 新类型、具名 target、环境变量展开、dry-run 输出和错误路径均不泄露配置中的 URL/key。
- 原 webhook 测试继续通过，确认新增 exports 没有改变通用请求行为。
- 实施后运行 typecheck、CI tests 和 build，使用 mock 而不依赖真实 Grok Routine。

## 实施记录

- 新增 Grok Bot workspace、CLI 构造分支、source path mapping 与 lockfile 依赖；webhook
  package root 导出既有构造/发送函数及 dispatch plan type，未复制 transport 实现。
- resolved target 直接复用 `GrokBotConfig` 类型。内部 config 模块先单独验证替换连接，再用
  webhook resolver 合并显式 body 和编码配置；默认 body 只在 preparation 时生成。
- core 已限制 param key 为模板可接受的字符，无需增加转义机制或修改 core；默认 body 使用
  逐 key 占位模板，实际值保持单次替换。
- 构建和发布使用 workspace glob/递归命令，自动纳入新包，无须修改 workflow 或 pipeline。
- 同步架构总览、Grok Bot/webhook/CLI 架构、包/CLI README、skill reference 与占位示例。
- 固定 Node 26.12.1 / pnpm 12.15.0；`mise install` 确认版本已安装，沙箱只阻止全局 shim
  重建，`mise exec -- pnpm ...` 正常使用固定工具链。离线 install 已同步 workspace 依赖。
- `mise exec -- pnpm typecheck`、`mise exec -- pnpm test:ci`、`mise exec -- pnpm build`
  均通过；5 个包共 290 项测试，包括 Grok Bot 67 项和 CLI 新增 7 项，原 webhook 65 项通过。
  直接运行新包测试之前需先构建依赖；根 test:ci 已通过 Turbo 自动完成该顺序。
- Grok Bot 测试全部使用 mock Fetch；仅在临时目录写占位配置。未读取、输出或修改真实
  `.env`，未创建或触发真实 Routine，未验证实际账户 response body 或 text/plain 接受情况。
