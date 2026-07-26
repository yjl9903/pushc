# Webhook adapter 优化实现计划

## 1. 文档定位

本文是下一轮 webhook 优化的实现规范，负责定义代码应达到的行为。手机推送服务的上游
接口、字段和配置示例见 [`docs/reference/webhook.md`](../reference/webhook.md)；reference
只记录外部事实，不承担实现决策。

本次为直接破坏性升级：删除旧 API、`body_mode`、默认 body 和兼容分支，不提供迁移层。
实现完成时，architecture、代码、测试、README、Skill 和本文必须一致。

## 2. 目标与范围

### 2.1 目标

1. 保留一个高自由度的通用 `webhook` adapter，通过配置覆盖 Bark、ntfy、Gotify、
   Pushover 等手机通知服务，不为这些服务增加专用 adapter。
2. 统一 core、adapter 和 client 的发送模型，让单次发送可以携带正文、标题和简单扩展参数。
3. 允许 webhook target 覆盖完整请求配置，并把发送参数渲染到 request URL、header value 和
   body string value。
4. 使用标准 media type 表达 body 格式，明确配置期、发送期和 Fetch 边界的校验规则。
5. 保持 core runtime-neutral；新增校验只覆盖本轮触达的 core send boundary 和 webhook。

### 2.2 本轮不做

- 不抽象 `priority`、`sound`、`image`、`actions` 等产品字段；它们继续使用上游原始字段名。
- 不支持复杂扩展参数、嵌套 param、JSON CLI 参数或 param 自动合并 body。
- 不支持 URL encoding、JSON encoding 或其他模板 filter。
- 不支持 `application/x-www-form-urlencoded`、`multipart/form-data` 或字符集转码。
- 不改变 HTTP 成功判断、重试和 CLI 外层输出格式；webhook receipt 简化为 `{ status }`。
- 不增加秘密扫描、`.env` 内容检查或 resolved config 输出。

## 3. 关键技术决策

1. `body_mode` 直接删除，由 `content_type` 取代；本轮只支持 `application/json` 和
   `text/plain`。
2. `body` 没有缺省值。未配置 body 时，请求不携带 body，也不自动生成 Content-Type。
3. 本轮唯一新增的固定发送字段是可选 `title`；正文固定为 `message`；任意扩展字段放在
   `param`。
4. 模板变量固定为 `{{message}}`、`{{title}}` 和 `{{param.key}}`。模板只扫描一次，不递归
   渲染 replacement。
5. adapter URL 是初始化时确定的静态可信 endpoint；adapter 或 target 的 `request.url` 支持
   send-time 模板，且最终 URL 必须是与 adapter URL 同 origin 的绝对 HTTP(S) URL。
6. target 可以覆盖 webhook 的全部请求字段。headers 按大小写不敏感的 name 浅合并；只有
   plain JSON object body 执行顶层浅合并，其他 body 由 target 整体替换。
7. core 和 webhook 本轮涉及的 runtime boundary 使用 Zod。每个实际 import Zod 的 workspace
   都声明自己的直接依赖；Zod error 不作为公共错误暴露。
8. resolved target 保持为普通的只读配置对象；`sendTarget` 根据 target、payload 和 options
   构造本次请求。开放 key 的 headers 和 JSON object 只在解析、合并或请求构造的局部过程使用
   `Map`，避免 `__proto__`、`constructor` 等 object property 语义影响判断。
9. 配置期和 send-time 的配置错误统一为 `INVALID_CONFIG`；transport、HTTP、timeout 和取消
   继续使用现有发送错误语义。
10. `config.toml` 是允许 agent 阅读和修改的非敏感明文；秘密只允许通过 `${ENV_NAME}` 从
    `.env` 或进程环境注入。agent 禁止读取 `.env`。

## 4. 公共数据结构与 API

### 4.1 Core 发送类型

删除旧 `PushMessage`、`PushAdapterSendInput` 和 `PushClientSendInput`，改为以下公共模型：

```ts
export interface PushPayload {
  readonly message: string;
  readonly title?: string;
  readonly param?: Readonly<Record<string, string>> | null;
}

export interface PushSendOptions {
  readonly signal?: AbortSignal;
}

export type PushTargetInput = string | Readonly<Record<string, unknown>>;

export type PushDestination =
  | string
  | {
      readonly adapter: string;
      readonly target?: PushTargetInput;
    };

```

base adapter 校验 payload 后直接把安全复制的 `PushPayload` 传给 concrete adapter；缺省
缺省、`undefined` 或 `null` 的 `param` normalize 后保持 `undefined`，需要模板上下文的
adapter 将其视为空 Record。后续新增公共发送
字段加入 `PushPayload`，不混入 `param`。

```ts
abstract class PushAdapter<TConfig, TTarget extends object, TReceipt> {
  readonly targets: PushTargets<TTarget>;

  send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options?: PushSendOptions
  ): Promise<TReceipt>;

  abstract parseTarget(input: unknown): TTarget;
  protected abstract sendTarget(
    target: TTarget,
    payload: PushPayload,
    options: Readonly<PushSendOptions>
  ): Promise<TReceipt>;
}

class PushTargets<TTarget extends object> {
  register(name: string, input: Readonly<Record<string, unknown>>): this;
  resolve(input?: PushTargetInput): TTarget;
}
```

`parseTarget` 把 adapter default 与 partial 合并、校验并返回 resolved `TTarget`。
`PushTargets` 保存的就是这个 target 配置，`get()/resolve()/values()` 可以直接返回它。
core 不尝试用 resolved `TTarget` 推导 adapter-specific input；具体 adapter 的
`parseTarget(input)` 负责校验临时和具名配置对象。内部 Map 和最终 HTTP request 都是
`sendTarget` 内的 request-local 临时值，不进入 core 类型或 target registry。

### 4.2 Adapter API

```ts
adapter.send(target, payload, options?)
```

- `target` 为具名 target string、临时 target partial 或 `undefined`；`undefined` 使用 adapter
  default。
- `payload` 为 `PushPayload`。
- `options` 只保存 signal 等发送控制项，不保存消息内容。
- base adapter 负责 payload、options 和通用 target 形态的校验与归一化。
- `sendTarget(target, payload, options)` 与公共 send 的三个语义参数保持一致；concrete
  adapter 不重复执行公共 input normalization。

### 4.3 Client API

```ts
client.send(destination, payload, options?)
```

- string destination 使用 `adapter[:target]`，例如 `bark` 或 `bark:urgent`。
- string 只允许零个或一个冒号；冒号两侧分别按 destination name pattern 校验，`adapter:`、
  `:target` 和多冒号 destination 均为 `INVALID_TARGET`。
- object destination 使用 `{ adapter, target? }`；target 可以是具名 string 或临时配置对象。
- core 负责解析 destination string 和选择 adapter；CLI 不再把发送输入拼成旧单对象 API。
- 发送结果继续只在使用具名 string target 时包含 `target`。

### 4.4 Adapter 对 payload 的处理

- webhook 只在配置显式引用模板变量时使用 `title` 和 `param`，不会自动把它们加入 body。
- NapCat 继续发送 `message`，明确忽略本轮不支持的 `title` 和 `param`。
- core 不实现产品语义、fallback 或字段映射；每个 adapter 自己记录和测试其行为。

## 5. Core runtime 校验

### 5.1 Payload

- `message` 必须是 string，且 trim 后非空；校验不修改原字符串。
- `title` 存在时必须是 string；空字符串合法，并在模板 `:-` 中视为无值。
- 非 nullish `param` 必须是 plain object，每个 value 必须是 string，未知 payload 字段直接
  拒绝。
- `param` key 必须匹配 `[A-Za-z0-9][A-Za-z0-9_.-]*`，大小写保留并区分大小写。
- 缺省、`undefined` 或 `null` param 保持 `undefined`；object param 复制为冻结的
  null-prototype Record。
- param 查询必须使用 `Object.hasOwn()`，不得从 prototype chain 读取 `constructor`、
  `toString` 等名称。
- payload 校验失败映射为 `PushError('INVALID_MESSAGE')`，不暴露 `ZodError`。

### 5.2 Destination 和 options

- destination object 使用 strict schema；adapter name 和具名 target name 继续遵循
  destination name 规则。
- destination 错误映射为 `INVALID_TARGET`；adapter 不存在仍使用 `ADAPTER_NOT_FOUND`。
- options 使用 strict schema；失败映射为新增的 `INVALID_SEND_OPTIONS`。
- `signal` 不使用 `z.instanceof(AbortSignal)`，避免缺失全局 constructor 和跨 realm 失败。
  使用 runtime-neutral guard 校验发送路径需要的 `aborted`、`addEventListener` 和
  `removeEventListener`。
- signal 校验后保持原对象 identity，不 clone、不包装。
- 完成 payload/options 校验后立即检查预取消 signal。若已取消，返回
  `PushError('SEND_FAILED')`，以 `signal.reason` 为 cause；不得继续解析 target、渲染模板或
  构造请求。

### 5.3 Record 输入

本轮只面向 TOML 配置和普通 Node API 数据对象：

- Record 必须是非 null、非 array object。
- Zod strict schema 校验固定字段；开放 key 使用 `z.record()` 和既定 value schema。
- 只处理 enumerable string key。
- 不为 getter、Proxy、自定义 prototype、symbol 等非常规 Node API 输入增加专项规则或测试。
- 校验和复制过程中抛出的异常统一按对应的稳定 pushc 配置/输入错误包装。

## 6. CLI 变化

`pushc send` 新增：

```text
pushc send --target bark \
  --title "Build completed" \
  --param group=deployments \
  --param level=active \
  "Production deployment succeeded"
```

### 6.1 固定参数

- 新增长选项 `--title <title>`。
- CLI 使用 kebab-case，core payload 使用 camelCase，模板固定字段使用 snake_case；本轮
  `title` 在三层拼写相同。
- 消息位置参数、`--file` 和 stdin 的既有优先级与冲突规则不变。

### 6.2 `--param`

- 使用 Breadc 数组选项 `--param [...entry]`，允许重复提供 option。
- 每项按第一个 `=` 分成 key/value；其余 `=` 属于 value。
- key/value 都不 trim。
- 空 value 合法：`--param group=` 得到 `''`，会触发模板 fallback。
- 只包含空格的 value 是非空字符串，不触发 fallback。
- 含空格的 key 因不符合 key 正则而失败。
- 缺少 `=`、空/非法 key 和同一次发送重复 key 都返回 `CLI_USAGE`、exit 2。
- 重复比较保留大小写并区分大小写；不采用后值覆盖。
- key 中的 `.` 是普通字符，不创建嵌套结构。
- 不解析 number、boolean、null、array、object 或 JSON。

CLI 参数不是秘密传递渠道；token/key/password 仍只能来自环境变量。

## 7. Webhook 配置模型

### 7.1 外部配置字段

adapter 顶层只接受 `url`、`request` 和 `response`：

| 顶层字段 | 类型 | 默认值 | target 可覆盖 | 说明 |
| --- | --- | --- | --- | --- |
| `url` | string | 无 | 否 | 必填静态可信 endpoint；配置层展开 env 后建立 origin |
| `request` | table | 空 | 按字段覆盖 | 当前 HTTP request 配置 |
| `response` | empty table | 空 | 空占位 | 为后续响应解析预留，本阶段不执行任何行为 |

adapter 与 target 的 `request` 都使用 snake_case request 字段；target 只接受
`request`/`response` partial：

| `request` 字段 | 类型 | 默认值 | target 可覆盖 | 说明 |
| --- | --- | --- | --- | --- |
| `url` | string | adapter 顶层 `url` | 是 | 可含 send-time 模板；最终必须同 origin |
| `method` | string | `POST` | 是 | trim 后统一大写 |
| `headers` | string table | 空 | 是 | 按 normalized name 合并 |
| `content_type` | string | body 存在时 `application/json` | 是 | 只支持 JSON/text essence |
| `timeout_ms` | integer/bigint | `10000` | 是 | 范围 `1..2_147_483_647` |
| `body` | JSON value 或 string | 无 | 是 | 不自动生成消息结构 |

旧的顶层 request 字段及其他未知字段返回 `INVALID_CONFIG`，不提供兼容或迁移分支。

默认值在 adapter request 与 target request 合并后按最终 request 统一解析：动态
`request.url` 缺省时使用顶层静态 `url`；`method`、`headers`、`timeout_ms` 分别缺省为
`POST`、空集合、`10000`；`body` 缺省为 `undefined`。
`content_type` 只有在最终 body 存在且该字段缺省时才补为 `application/json`；最终无 body 且
未显式配置时仍为 `undefined`，显式配置的值则保留但不自动产生 header。由 target 首次提供
body 的请求也遵循这一规则，不能因为 adapter 本身没有 body 而漏掉 JSON 默认 serializer。

示例：

```toml
[adapters.bark]
type = "webhook"
url = "https://api.day.app/push"

[adapters.bark.request]
method = "POST"
content_type = "application/json"

[adapters.bark.request.body]
device_key = "${BARK_DEVICE_KEY}"
body = "{{message}}"
title = "{{title:-pushc}}"
group = "{{param.group:-pushc}}"

[adapters.bark.response]
```

`adapters.bark.request.body` 是 HTTP request body；内层 `body` 是 Bark 的原始字段，
webhook 不解释其产品语义。`response` 当前只允许空 table，并且不参与发送。

### 7.2 Target 配置与内部 request

`parseTarget` 返回新建的 `WebhookTargetConfig`，包含 resolved `request` 与空
`response`。它是 `PushTargets` 保存并传给 `sendTarget` 的 resolved target。

```ts
interface WebhookRequestConfig {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly content_type?: string;
  readonly timeout_ms: number;
  readonly body?: JsonValue;
}

interface WebhookResponseConfig {}

interface WebhookTargetConfig {
  readonly request: WebhookRequestConfig;
  readonly response: WebhookResponseConfig;
}

interface WebhookRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly timeout_ms: number;
  readonly body?: string;
}
```

`sendTarget(target, payload, options)` 根据这三个值生成一次性的 `WebhookRequest`：

1. 复制 `target.request` 的 headers/body，建立 request-local Map/JSON tree。
2. 用 payload 构造模板上下文并渲染 URL、header value 和 body string value。
3. 校验最终 URL、headers、Content-Type 和 method/body 组合。
4. 序列化 body，并将 resolved `timeout_ms` 写入 request。
5. `sendWebhook(fetch, request, options)` 从 request 读取 timeout，组合 signal 并调用 Fetch。

Map、模板中间结果和 Fetch init 都不缓存、不进入 target config，也不在不同发送之间复用。

## 8. Adapter 与 target 合并

每个具名或临时 target 的 `request` 都先与 adapter request default 合并，再校验其
resolved request：

1. `url`、`method`、`content_type`、`timeout_ms` 等标量由 target 值整体覆盖。
2. adapter 和 target 各自先解析 headers：
   - header name 按 ASCII 大小写不敏感 normalize 为小写；
   - 同一层两个原始 name normalize 后相同时返回 `INVALID_CONFIG`；
   - name/value 类型和静态 name 语法在该层解析时校验。
3. 两层 headers 使用局部 Map 浅合并；target 同名 header 胜出，adapter 未被覆盖的 header
   保留。resolved target 中物化为新建的 null-prototype Record。
4. 仅当 adapter body 和 target body 都是 plain JSON object 时，使用局部 Map 按 top-level
   key 浅合并；target 同名 key 胜出，嵌套值不递归合并。
5. 其他所有 body 组合由 target body 整体替换，包括 array、string、number、boolean、null、
   JSON primitive、text body和类型不同的组合。
6. target 未提供 body 时继承 adapter body；两侧都未提供时 body 为 `undefined`。
7. 字段是否存在使用 own-property presence 判断，不能使用 `??`。Node API 中显式
   `body: null` 是合法 JSON body，必须按 target body 参与覆盖或合并判断，不能当成缺省。
8. 本轮不提供删除继承 body、删除单个继承 header 或删除继承标量的语法。`headers = {}` 只
   表示没有新增 header，不会清空 adapter headers；target 缺少字段表示继承，空字符串是显式
   覆盖值而不是删除。TOML/Node input 中的 `null` 不作为 tombstone；其中 `body: null` 按上条
   作为合法 JSON body，其他不接受 null 的字段仍返回 `INVALID_CONFIG`。未来若需要删除语义，
   单独设计显式 tombstone。

`response` 本阶段只接受空 object，不参与合并、请求构造或 receipt 处理。具名 target 注册时
保存合并和复制后的普通配置对象；临时 target 在 send-time 走同一合并逻辑；default 使用
adapter 自身请求配置。`sendTarget` 每次重新复制请求数据，不依赖 target 对象不可变。一个
adapter 可以让多个 target 指向同 origin 下的不同 endpoint。

## 9. 模板语言

### 9.1 可用变量

```text
{{message}}
{{title}}
{{param.group}}
{{title:-pushc}}
{{param.group:-default}}
```

- `message`：必填正文。
- `title`：可选固定字段。
- `param.<key>`：一层扩展参数；`param.foo.bar` 查询 key `foo.bar`，不进行路径遍历。
- 固定字段与 param 命名空间不冲突：`{{title}}` 和 `{{param.title}}` 是两个变量。

### 9.2 默认值和缺失值

- 语义参考 Bash `${parameter:-word}`：变量缺失或值为 `''` 时使用 fallback。
- 没有 fallback 的缺失变量渲染为 `''`。
- expression 两端允许 ASCII whitespace，`{{ title }}` 等价于 `{{title}}`。
- 去除 expression 外围 whitespace 后，按第一个 `:-` 分隔变量名和 fallback；变量名再次
  trim，fallback 保留剩余字面内容。`{{title:-alpha:-beta}}` 的 fallback 是
  `alpha:-beta`。
- fallback 可以为空；fallback 不递归执行模板、shell、命令或环境变量展开。
- CLI 配置加载会在模板引擎之前展开整个 TOML string 中的 `${ENV_NAME}`；直接调用
  core/adapter API 不执行该配置层展开。

### 9.3 单次扫描与非法表达式

- scanner 只从左到右扫描输入模板一次。
- message、title、param value 和 fallback 都是不透明 replacement；即使包含 `{{...}}` 也
  不再扫描，避免二次模板注入。
- 合法变量只有 `message`、`title` 和符合 key 规则的 `param.<key>`。
- 空表达式、filter、条件、未知变量和其他非法表达式完整保留原文，不中断发送。
- candidate 由 `{{` 后第一个 `}}` 结束；不支持在 expression 中转义 closing delimiter。

### 9.4 字面量转义

- `\{{...}}` 消费紧邻模板起始符的一个反斜杠并输出字面 `{{...}}`，不解析其中表达式。
- 更前面的反斜杠保持字面含义，不定义奇偶分组规则。
- 未闭合的 `{{` 保持原文。
- TOML basic/literal string 仍先遵循 TOML 自身的反斜杠规则。

### 9.5 渲染范围

- adapter 顶层 URL：禁止 send-time 模板。
- adapter 或 target 的 `request.url`：允许模板，包括 path、query 和 fragment 中的字符串内容。
- header：只渲染 value，不渲染 name。
- body：递归渲染 string value，不渲染 JSON object key；number、boolean、null 不变。
- `content_type`、`method` 和 `timeout_ms` 不支持模板。
- param 不自动进入 URL、headers 或 body；只有显式模板引用才生效。
- 本轮模板不自动进行 URL encoding。渲染后仍由标准 URL parser 执行原生 URL
  normalization/percent-encoding。

## 10. JSON body 归一化

### 10.1 支持值

- 正常输入限定为 JSON-shaped data：null、boolean、string、finite number、array 和 object。
- bigint 仅在 JavaScript safe integer 范围内转换为 number；其他 bigint 返回
  `INVALID_CONFIG`。
- replacer 遇到 undefined、symbol、function 或非 finite number 时返回 `INVALID_CONFIG`。
- Zod preprocess 必须保留 safe-bigint 行为，不能因 schema 迁移拒绝全部 bigint。

### 10.2 Object、array 与特殊 key

- JSON body 使用带 replacer 的 `JSON.stringify` 校验和标准化，再通过 `JSON.parse` 得到新的
  data tree。
- replacer 将 safe bigint 转为 number，并拒绝非 finite number、unsafe bigint 及其他非 JSON
  value。
- `__proto__`、`constructor`、`toString` 等 key 始终只是普通字符串。

### 10.3 Serialization failure

- `JSON.stringify` 无法处理的循环或其他输入统一返回 `INVALID_CONFIG`。
- 对 JSON-shaped data 之外的非常规 Node API 对象不定义额外兼容行为；其结果以 replacer 和
  原生 JSON serialization 为准，抛出的异常统一包装为 `INVALID_CONFIG`。

## 11. Content-Type 与 serializer

### 11.1 `content_type`

- body 存在且未配置 `content_type` 时，默认 `application/json`。
- 本轮只接受以下语义值，匹配时忽略大小写和外围空格：
  - `application/json`
  - `application/json; charset=utf-8`
  - `text/plain`
  - `text/plain; charset=utf-8`
- `;` 和 `=` 两侧允许空格；normalize 后只保留 essence 和是否显式声明 UTF-8。其他参数、
  其他 charset、quoted-string 和其他 media type 全部返回 `INVALID_CONFIG`。
- `application/json` 使用 JSON serializer。
- `text/plain` 要求最终 body 为 string，直接交给 Fetch。

### 11.2 与显式 header 的关系

body 存在时：

1. 根据 `content_type` 或默认值选择 serializer。
2. 若 merged headers 没有 `content-type`，自动写入 `content_type` 的完整值。
3. 若 headers 显式提供 `Content-Type`，它也必须匹配上述固定输入，且 essence 必须与
   `content_type` 相同。
4. essence 相同但 charset 写法不同，以 header 完整 trim 后的原值作为最终请求 header；
   serializer 仍按共同 essence 选择。

body 不存在时：

- 跳过 serializer，Fetch init 省略 `body`。
- 不根据 `content_type` 自动生成 Content-Type。
- 只保留 headers 显式提供的 Content-Type。
- 无 body 时，显式 header 只作为普通 header 交给 `Headers` 校验，不解析 media type，也不与
  `content_type` 比较。

## 12. URL、method、headers 与 timeout

### 12.1 URL

Adapter URL：

- app 配置层先完成 `${ENV_NAME}` 展开；直接构造 adapter 时使用调用方原值。
- adapter 初始化时用标准 URL parser 解析，只接受绝对 `http:`/`https:` URL。
- embedded username/password 返回 `INVALID_CONFIG`。
- adapter URL 不进入 send-time scanner；包含 `{{` 的 adapter URL 直接返回
  `INVALID_CONFIG`。
- 保存 parser normalize 后的 URL 字符串和静态 `URL.origin`。

Request URL：

- 必须是带显式 scheme 的绝对 HTTP(S) URL；不支持 `/path`、`path`、`?query` 或
  `//host/path` 等相对形式。
- adapter `request.url` 未配置时使用顶层静态 URL；target `request.url` 未覆盖时继承
  adapter resolved request URL。
- request URL 原文保存在 resolved request 配置中，统一在 send-time 渲染后完成 URL、
  credentials 和 origin 校验。
- 最终 normalized `URL.origin` 必须与 adapter 静态 origin 完全相同；这同时限制 protocol、
  hostname 和 port，禁止跨 host 和 HTTPS 降级。
- 显式 default port 由标准 parser normalize，因此与省略 default port 视为同 origin。
- Fetch 使用最终 `URL.toString()`；模板本身不编码，但 URL parser 可以执行标准
  percent-encoding、hostname normalization 和 default-port 消除。
- redirect 继续使用原生 Fetch 行为，本轮不限制 redirect 或跨 host redirect。

### 12.2 Method

- 默认 `POST`。
- trim 后统一转大写；标准和自定义 method 都不保留原始大小写。
- 空值或不符合 HTTP token grammar 的 method 返回 `INVALID_CONFIG`。
- Fetch 禁止的 `CONNECT`、`TRACE`、`TRACK` 返回 `INVALID_CONFIG`。
- `GET`/`HEAD` 的最终 body 只要不是 `undefined` 就返回 `INVALID_CONFIG`，包括空 string、
  null、空 object 和空 array。
- 其他 method/body 组合不增加产品级限制，以原生 Fetch 能力为边界。

### 12.3 Headers

- header name 必须是合法 HTTP token；value 必须是 string。
- name normalize 为小写后存入 Map；单层 case-insensitive 重复为 `INVALID_CONFIG`。
- header value 统一在 send-time 渲染后用标准 `Headers` 校验。
- 最终 Map 转换为 tuple array 后交给 `Headers`：`new Headers([...headersMap])`。当前项目的
  `HeadersInit` 类型不接受 `Map` 本身，因此不得把 Map 直接作为参数；也不经普通 object
  物化。

### 12.4 Timeout

- 默认 `10000` ms。
- number 必须是 `1..2_147_483_647` 的整数。
- bigint 只在同一范围内转换为 number；其他 number/bigint 返回 `INVALID_CONFIG`。
- 上限避免 `setTimeout` overflow 后退化为近即时 timeout。

### 12.5 Runtime Web API 要求

Webhook 保持 runtime-neutral，不依赖 Node API，但运行时需要标准 `URL`、`Headers`、
`AbortController` 和 Fetch。`CreateWebhookAdapterOptions.fetch` 继续只覆盖 Fetch function。

本轮只保留现有 Fetch 检查：调用 `sendTarget` 时 fetch 不可用，抛出
`WebhookError('FETCH_UNAVAILABLE')`；直接 adapter 调用收到该错误，通过 client 调用时按普通
发送失败包装为 `PushError('SEND_FAILED')`，CLI 使用 exit 1。`pushc targets` 不检查 Fetch，
也不发送请求。其他 Web API global 的统一检查和错误分类不在本轮展开，留给后续错误体系专项。

## 13. 配置期与发送期流程

### 13.1 配置加载和 adapter 初始化

1. app 层加载 TOML 和旁边的 `.env`，完成 `${ENV_NAME}` 展开；core 和 adapter 自身不读取
   配置文件或环境变量。
2. WebhookAdapter 解析 adapter 层字段，建立 static URL/origin 和 normalized defaults。
3. adapter default 中所有不依赖 payload 的规则立即校验。
4. 具名 target 注册时完成继承合并和 normalization。

### 13.2 单次发送

1. client 校验 destination、选择 adapter。
2. base adapter 校验并归一化 payload/options。
3. 检查预取消 signal；已取消则立即失败。
4. 解析 default、具名或临时 target。临时 target 此时完成合并和静态校验。
5. 构造 `message`、`title`、`param` 模板上下文。
6. 单次扫描 request URL、merged header values 和 body string values；顶层静态 URL 不渲染。
7. 解析最终 URL，校验绝对 HTTP(S)、credentials 和同 origin。
8. 构造最终 Headers，解析最终 Content-Type 并执行冲突/charset 规则。
9. body 存在时选择 serializer；不存在时省略 Fetch body 和自动 Content-Type。
10. 使用已经 normalized 的 method，校验 GET/HEAD body 边界。
11. 请求构造完成后，发送函数读取 `WebhookRequest.timeout_ms`，创建
    timeout/parent-signal 组合并发起 Fetch。timeout 只计算 Fetch 请求和响应等待时间，不包含
    前面的同步 target 解析、模板渲染、URL/Headers 构造或 serialization。所有成功和异常出口
    都在 `finally` 清理 timer 与 parent listener。

### 13.3 验证阶段

配置解析和具名 target 注册阶段验证：

- 未知字段、字段类型、method、timeout 和 Content-Type 固定输入。
- header name 和大小写不敏感的重复 name。
- body 能否标准化为支持的 JSON/text 数据。
- adapter 静态 URL 和可信 origin。

发送阶段验证：

- 渲染后的 request URL、同 origin 和 embedded credentials。
- 渲染后的 header value 与最终 Content-Type 冲突。
- body serializer 及 GET/HEAD body 限制。

`pushc targets` 只能证明配置可解析，以及 adapter/default 和具名 target 的结构有效。它不能
证明 request URL、header/body 模板结果或最终 HTTP request 有效，也不会构造伪 payload、
建立平台连接或发送测试请求。adapter 不提供主动初始化阶段；需要连接时由真实发送惰性获取。

## 14. 错误、取消与现有响应行为

### 14.1 配置错误

- webhook config/target/request builder 内部使用 `WebhookError('INVALID_CONFIG')`。
- JSON normalization、URL、Headers、Content-Type matcher 和 serializer 抛出的、确定属于用户
  配置的原生异常，在最靠近调用点的位置包装为 sanitized
  `WebhookError('INVALID_CONFIG')`。
- 固定 public message 不包含 resolved URL、header value、body 或秘密；原异常保留为 cause。
- `WebhookAdapter.parseTarget()` 在 target 解析边界、`sendTarget()` 在 request 构造边界分别捕获
  `WebhookError('INVALID_CONFIG')`，转换为 `PushError('INVALID_CONFIG')` 并保留 cause。这样
  具名/临时 target 和 send-time request 配置错误在离开 `adapter.send` 前都不会被 client
  包装成 `SEND_FAILED`。
- `sendTarget()` 不转换 Fetch、HTTP、timeout 或 abort 阶段的错误。
- 配置期/send-time 配置错误在 adapter、client 和 CLI 入口保持相同 code；CLI 使用 exit 2。
- `ZodError`、`TypeError`、`RangeError` 不直接泄漏给调用方。

`WebhookError` 增加 cause：

```ts
class WebhookError extends Error {
  readonly code: WebhookErrorCode;
  readonly status?: number;
  override readonly cause?: unknown;
}
```

constructor options 同时接受 `status` 和 `cause`，并通过标准 Error cause 链保留内部异常。

### 14.2 发送错误和响应

- `FETCH_UNAVAILABLE`、HTTP 非 2xx、timeout、调用方取消和其他 transport error 不转换成
  `INVALID_CONFIG`。
- client 继续只原样透传 `PushError`，其他发送异常按现有规则包装为 `SEND_FAILED`。
- webhook 继续只以 `response.ok` 判断成功。
- receipt 为 `{ status }`；响应文本等字段留给后续统一 receipt 设计。
- timeout 和 parent signal 继续组合；listener/timer 必须可靠清理。
- 本轮不增加 retry，避免不确定失败导致重复通知。

## 15. 配置与秘密边界

- `config.toml` 必须可供 agent 读取、分析和修改，因此不得包含真实 token、key、password、
  credential 或私密 webhook URL。
- 秘密只在 TOML 中以 `${ENV_NAME}` 占位，并由旁边 `.env` 或进程环境提供。
- agent 禁止读取、打印或修改 `.env` 内容；pushc 运行时仍可按现有机制加载它。
- `--title` 和 `--param` 不作为秘密传递渠道。
- 本轮不做启发式秘密检测，不检查 `.env` 是否存在或是否被 gitignore，也不扫描环境值。
- 更新 `skills/pushc/SKILL.md` 和 configuration reference：允许读取 `config.toml`，删除“编辑前
  inspect `.env`”要求，并明确禁止 agent 读取 `.env`。
- `targets`、错误和输出继续避免主动展示 adapter/target resolved config。

## 16. 实施顺序与文件范围

### 16.1 Architecture-first

先更新以下 ground-truth 文档，再修改代码：

- `docs/architecture/core.md`：新 payload、send API、context、校验和错误码。
- `docs/architecture/adapter-webhook.md`：配置、target 合并、模板、serializer、请求流程。
- `docs/architecture/pushc-cli.md`：`--title`、`--param`、destination 委托和 targets 边界。

### 16.2 Core

1. 在 `packages/core/package.json` 添加 Zod 直接依赖并更新 `pnpm-lock.yaml`；同步修改
   architecture 中“core 无 runtime dependency”的旧描述。不得依赖其他 workspace 的传递依赖。
2. 替换 send public types 和 exports，新增 `INVALID_SEND_OPTIONS`。
3. 实现 plain object、payload、destination、options 和 cross-realm signal 校验。
4. 更新 `PushAdapter.send`、`PushClient.send`、`sendTarget` 和所有 call sites。
5. 更新 NapCat 到新 context，并测试忽略 title/param 的既有行为。

### 16.3 CLI/app

1. 增加 `--title` 和 `--param [...entry]`。
2. 实现 first-`=`、key regex、重复 key 和 CLI_USAGE 规则。
3. 将 destination string 直接交给新 client API。
4. 保持消息来源、输出外层格式和 destroy lifecycle 不变。

### 16.4 Webhook

1. 在 `packages/adapter-webhook/package.json` 添加 Zod 直接依赖并更新 `pnpm-lock.yaml`，重写
   config/target schema，删除 `body_mode`。
2. 使用 Zod 校验普通配置对象；通过 JSON stringify/parse 和 replacer 处理 JSON body、
   safe-bigint 与 serialization failure。Map 只作为解析、合并和请求构造的局部数据结构。
3. 实现 target 全字段覆盖、header merge 和 plain-object body shallow merge。
4. 实现单次 template scanner、默认值和单反斜杠字面量转义。
5. 实现固定 Content-Type 输入匹配和 JSON/text serializer。
6. 按确定阶段重组 request builder；实现 static origin、send-time final validation、Map 到
   Headers tuple array 的边界，并在 Fetch 前启动 request timeout。
7. 扩展 `WebhookError.cause`；在 `parseTarget()` 和 `sendTarget()` 的配置边界完成
   `PushError('INVALID_CONFIG')` 映射，其他 native error 保持发送错误语义。
8. 保持现有 Fetch 可用性检查、response 成功判断、timeout 和 abort 契约；receipt 简化为
   `{ status }`。

### 16.5 文档与 Skill

- 更新 root、core、webhook、CLI README 和所有旧 API 示例。
- 删除全部 `body_mode`、默认 body 和旧单对象 send API 描述。
- 更新 `docs/reference/webhook.md` 的配置语法，但不把实现细节移入 reference。
- 更新 `skills/pushc/SKILL.md`、`reference/cli.md`、`reference/configuration.md`。

## 17. 测试计划

### 17.1 Core

- 新 adapter/client 三参数签名和 destination string/object。
- core target input 使用具名 string 或普通配置 Record，不从 resolved target 推导 input 类型。
- default、具名、临时 target；未知 adapter/target；result target 字段。
- message/title/param strict validation、未知字段和 key regex。
- options/destination 错误码和 `INVALID_SEND_OPTIONS`。
- cross-realm/duck-typed signal、signal identity、预取消早于 target 解析。
- concrete adapter 错误包装保持现状；`PushError` 原样透传。

### 17.2 CLI

- `--title`、重复 `--param`、first-`=`、空 value、空格 value、非法/空 key、缺少 `=`。
- positional/file/stdin 既有规则不回归。
- 新 client 调用参数、text output、JSON 外层结构与 exit status 不变。

### 17.3 Webhook config 和 target

- `content_type` 四种固定语义输入、大小写/空格、非法参数、header 冲突与 winner。
- URL 必填，以及 method/headers/timeout/body/content_type 的完整默认矩阵；包括 adapter 无 body、
  target 首次提供 body 时默认 JSON。
- 无 body、JSON/text body、GET/HEAD body 拒绝、method normalize 和 Fetch 禁止 method。
- target 标量覆盖、headers case-insensitive merge/重复拒绝、body shallow merge/整体替换。
- target 字段 own-property presence；显式 `body: null` 不被当成缺省。
- 空 target headers 不清空继承 headers，缺失字段继承，null 不作为删除 tombstone。
- header/JSON 特殊 key 经过局部 Map 和 null-prototype object，不受 object prototype 影响。
- finite number、safe bigint、unsafe bigint、timeout bigint/范围上限。
- unsupported JSON value 和 serialization failure。

### 17.4 Template 和 URL

- message/title/param、缺失/空值 fallback、外围 whitespace、第一个 `:-`。
- 单次扫描、replacement 不递归、非法/未知/未闭合 expression 原样保留。
- `\{{...}}` 字面量转义。
- 不渲染 object key、header name、adapter URL 和非 string body。
- adapter static URL、absolute request URL、具名 target 和临时 target。
- default port normalization、embedded credentials、同 origin、跨 origin和 HTTPS 降级拒绝。
- URL parser 原生 normalization；渲染后 header newline 等最终 Headers 错误。

### 17.5 Request、错误和 lifecycle

- 无 body 时省略 Fetch body/自动 Content-Type。
- headers Map 通过 tuple array 构造 `Headers`，并保持特殊 key/value。
- 重复发送和不同 payload 的并发发送不共享 Map、模板结果或 request init。
- JSON/text serialization 和固定 Content-Type 输入。
- 原生 normalizer/URL/Headers/serializer error 的 sanitized message、cause 和
  `INVALID_CONFIG` mapping。
- 直接 adapter、client 和 CLI 对 send-time config error 的一致性。
- fetch 不可用时，直接 adapter 返回 `FETCH_UNAVAILABLE`，client/CLI 按 `SEND_FAILED` 处理；
  `pushc targets` 不检查 fetch。
- HTTP non-2xx、timeout、parent abort、listener/timer cleanup 和 `{ status }` receipt；断言
  timeout 在 Fetch 前启动，不计算同步 request 构造时间。
- `pushc targets` 只验证配置结构和 adapter 初始化，不发送 webhook 请求。

最终运行：

```text
pnpm format
pnpm typecheck
pnpm test:ci
pnpm build
```

## 18. 验收标准

1. Bark、ntfy、Gotify、Pushover 基础 JSON 请求可只通过通用 webhook 配置表达。
2. CLI 和 Node API 能为单次发送提供 `message`、`title` 和一层 string `param`。
3. `body_mode`、默认 body、旧 send API 和相关兼容代码完全删除。
4. target 覆盖、模板、URL origin、Content-Type、method、JSON 和 timeout 规则与本文一致。
5. 能在配置期确定的错误尽早发现；只能在发送期确定的配置错误稳定为 `INVALID_CONFIG`，不被误包装为
   `SEND_FAILED`，不泄漏 resolved secret 或原生校验异常。
6. webhook receipt 为 `{ status }`；HTTP 成功判断、CLI 外层输出格式和非配置发送失败行为
   保持现状。
7. config 示例只使用环境变量占位符；Skill 允许读 config、禁止读 `.env`。
8. architecture、reference、README、Skill、类型声明、实现和测试没有旧规则残留。
9. `sendTarget` 只接收 target、payload 和 options，并在内部构造 request；不同发送不共享可变
   请求状态。
10. core 和 webhook 各自声明直接 Zod 依赖。
11. format、typecheck、test 和 build 全部通过。

## 19. 后续 TODO

- 为 URL、query、header 和 body template 设计显式 encoding/filter 语法。
- 增加 form-urlencoded、multipart 和其他 serializer；需要时再设计非 UTF-8 转码。
- 支持复杂 param、嵌套对象或从 JSON 文件读取扩展参数。
- 支持可配置成功 status、JSON response 断言和 receipt 提取。
- 设计 retry policy、可重试状态、退避、幂等与取消语义。
- 重新设计 CLI text/JSON output、receipt 和错误输出格式。
- 系统化处理 URL path/query、Authorization header、body token 和 error chain 脱敏。
- 增加无需 agent 读取 `.env` 的环境变量连通性检查。
- 统一 adapter/core/CLI 的完整错误分类和映射，包括 runtime capability error。
