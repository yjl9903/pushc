# `@pushc/core`

## 定位与依赖

`packages/core` 是运行时无关的消息编排内核。它依赖 Zod 完成公共发送边界校验，但不依赖
Node API、TOML parser、platform SDK 或任何 concrete adapter。它定义 adapter 接入契约、
adapter registry、adapter 私有 target registry 和发送调度。

## 公共发送模型

原始消息输入、归一化消息与发送控制分离：

```ts
type PushContent =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'attachment';
      readonly source: string;
      readonly name?: string;
      readonly mediaType?: string;
    };

interface PushPayload {
  readonly content: string | readonly string[] | readonly PushContent[];
  readonly attachments?: readonly string[];
  readonly title?: string;
  readonly param?: ReadonlyMap<string, string>;
}

interface NormalizedPushPayload {
  readonly content: readonly PushContent[];
  readonly title?: string;
  readonly param?: ReadonlyMap<string, string>;
}

interface PushSendOptions {
  readonly signal?: AbortSignal;
  readonly dryRun?: boolean;
  readonly basePath?: string;
}

interface TemplateContext {
  readonly variables?: ReadonlyMap<string, string | undefined>;
  readonly namespaces?: ReadonlyMap<string, ReadonlyMap<string, string> | undefined>;
}

type PushTargetInput = string | Readonly<Record<string, unknown>>;
type PushDestination = string | { readonly adapter: string; readonly target?: PushTargetInput };
```

adapter 使用 `send(target, payload, options?)`；client 使用
`send(destination, payload, options?)`。string destination 格式为 `adapter[:target]`，只允许
零个或一个冒号。object destination 为 strict object，target 可以是具名 string 或临时配置
object。

payload 为 strict object。`content` 必填，接受 string、纯 string array 或纯
`PushContent` array。string 转成一个 text node，string array 逐项转成 text node；
`attachments` 只允许与快捷输入组合，并按输入顺序转成 attachment nodes 后排列在 text nodes
之前；缺省或为 `undefined` 都表示未提供。显式 AST 保持顺序，只要提供非 `undefined` 的
`attachments` 字段即非法；空 content array 只有在 shortcut attachments 非空时合法。混合
string/object array、未知 node 字段和 `<adapter>:<node>` 等未实现 node type 均为
`INVALID_MESSAGE`。

core 先校验 `title` 与 `param`，再渲染所有输入形式产生的 content node。text 的 `text` 和
attachment 的 `source`、`name`、`mediaType` 支持 `{{title}}`、`{{param.key}}` 与
`{{variable:-fallback}}`；`type` 不渲染，`{{message}}` 在 content 中不是已知变量。渲染只
扫描一次，不递归处理 replacement 或 fallback；`\{{...}}` 输出字面 expression，未知、非法
或未闭合 expression 原样保留。模板不做 URL、JSON 或路径编码。

最终消息必须至少包含一个 trim 后非空的 text 或 attachment。渲染后的 attachment source
trim 后非空，可选 name trim 后非空，可选 mediaType 必须是 `type/subtype`。`title` 为可选
string，空 string 合法；原始 `param` 缺省或为 `undefined` 表示未传，normalize 后不保留该
字段。非 `undefined` 的 `param` 必须是 `ReadonlyMap<string, string>`，key 匹配
`[A-Za-z0-9][A-Za-z0-9_.-]*`。core 为 normalized payload 复制新的 Map，调用方后续修改原
Map 不会影响 adapter。node、content array 与 normalized payload 同样由 core 重新构造；
调用方的 content array 和 node 引用不会进入 adapter。
payload 错误为 `INVALID_MESSAGE`。非常规 JavaScript object、array 和与 object prototype
成员冲突的动态 key 遵循系统架构定义的运行时输入边界，不增加专项兼容逻辑。

`src/content.ts` 专门负责消息内容结构：展开快捷 attachments、保留 AST 顺序、严格校验公共
node 字段、渲染 node string、判断有效内容并构造 normalized node 与 content array。
`src/template.ts` 导出 runtime-neutral 的 `renderTemplate(template, context)` scanner；
`variables` 表示 `title`/`message` 等标量 Map，`namespaces` 表示 `param` 等嵌套 Map，只有
context Map 中声明的变量或 namespace 会被消费。`src/validation.ts` 只负责 payload 外层元数据
和 send options；三者共同形成公共错误边界。

options 为 strict object。signal 必须是标准 `AbortSignal` instance，并保持原 identity；
`basePath` 是可选非空 string，表示本次消息中相对引用的解析上下文；core 不解释其路径格式
或 adapter 语义，只原样复制到
`PushAdapterOperationOptions`。options 错误为 `INVALID_SEND_OPTIONS`。`dryRun` 为可选
boolean；为 `true` 时只准备最终 request，不执行平台传输。payload/options 校验后立即检查
预取消 signal，失败为 `SEND_FAILED`，且不得继续解析 target。

## Adapter 与 Target 契约

`PushAdapter<TConfig, TTarget, TReceiptRequest, TReceiptResponse, TTransportRequest>` 保存
只读 `config` 与 `targets`。base class 的公共 `send` 完成公共 input normalization，并把本地
preparation 与目标服务 dispatch 分开：

```ts
interface PushPreparedRequest<TReceiptRequest, TTransportRequest> {
  readonly receiptRequest: TReceiptRequest;
  readonly transportRequest: TTransportRequest;
}

protected abstract prepareRequest(
  target: TTarget,
  payload: NormalizedPushPayload,
  options: PushAdapterOperationOptions
): Promise<PushPreparedRequest<TReceiptRequest, TTransportRequest>>;

protected abstract dispatchRequest(
  prepared: PushPreparedRequest<TReceiptRequest, TTransportRequest>,
  options: PushAdapterOperationOptions
): Promise<PushDispatchResult<TReceiptRequest, TReceiptResponse>>;
```

`prepareRequest` 接收 resolved target、normalized AST payload 与调用方 signal/attachment
base options。attachment source 此时已经由 core 完成模板渲染；adapter 必须基于最终 source
判断 URL、绝对路径或相对路径，并只在需要时使用 `basePath`。它可以异步访问本地
资源，但不得连接、上传、Fetch 或访问目标服务。
`receiptRequest` 是公开、可序列化的 receipt 投影；`transportRequest` 是内部平台请求，
core 不返回或记录它。`dispatchRequest` 接收完整 preparation result，是唯一允许目标服务
交互的 hook，返回 response、summary 或 error result，不组装 receipt。若 dispatch 期间
取得了 preparation 阶段不可用的远程元数据，adapter 可以基于原 `receiptRequest` 形成最终
投影，并通过 result 的 `request` 回填；否则 core 使用 prepared `receiptRequest`。

`options.dryRun === true` 时，base class 等待完整 preparation 后直接返回只含
`receiptRequest` 的 receipt，不调用 `dispatchRequest`。正常发送由 core 统一把 request 与
dispatch result 组合为 receipt；dispatch 抛错也保留 request，preparation 失败则没有
receipt。prepare 完成后再次检查 signal，禁止已取消操作进入 dispatch；此时 preparation
已经成功，所以取消失败仍保留 `{ receipt: { request: receiptRequest } }`。concrete adapter
实现 `parseTarget(input)`，负责 adapter default、partial merge 和 adapter-specific 校验。

`PushTargets<TTarget>` 不从 resolved target 类型推导 input 类型。`register(name, input)`
只接受普通 readonly Record，交给 adapter `parseTarget` 后保存 resolved target。省略 target
使用 default；string 查找具名 target；Record 解析为不注册、不缓存的临时 target。registry
保持 Map-like API，同名注册返回 `DUPLICATE_TARGET`。

`PushAdapters.delete()` 与 `clear()` 是异步资源操作；先移除实例，再调用可选 `destroy`
hook，失败归一化为 `DESTROY_FAILED`。

## Client 与错误边界

`PushClient.send()` 先校验 destination，再选择 adapter。不存在的 adapter 返回
`ADAPTER_NOT_FOUND`；destination 非法返回 `INVALID_TARGET`。发送结果为
顶层 `PushResult` 是 success/error 判别联合。成功包含
`PushSuccessResult` 的 `{ success: true, adapter, target?, receipt }`；失败包含
`PushFailureResult` 的 `{ success: false, adapter?, target?, receipt?, error }`。Receipt 只保存 adapter-specific
`{ request, response?, summary? }`，且必须可序列化。adapter result 先组合 receipt/error，
client 按 success/failure 分支显式构造结果，只复制协议规定的字段，再合并逐步解析出的
adapter 和具名 string target；result 的其他顶层字段不进入 PushResult。所有预期发送错误均
返回失败 result。
`PushClient.send(..., { dryRun: true })` 使用相同的 destination、adapter、target 与 payload
边界，返回固定带 `dryRun: true` 的 `PushDryRunResult`。成功包含
`{ dryRun: true, success: true, adapter, target?, receipt: { request } }`，失败包含
`{ dryRun: true, success: false, adapter?, target?, receipt?, error }`。dry-run 与正常 send
共用 receipt 层级，但类型上只允许 `request`，不会产生 `response` 或 `summary`。
adapter name 和 target name 统称 destination name，使用同一套格式规则；
`formatDestination(adapter, target?)` 由 core 统一把 destination 格式化为
`adapter[:target]`。destination 的名称校验、输入归一化和格式化聚合在
`utils/destination.ts`；名称正则是内部实现，不属于公共 API。

adapter 和 client 将 `PushError` 的 code/message 写入失败结果；意外 adapter 异常归一化
为 `SEND_FAILED`，无法进入 adapter 阶段的意外异常为 `INTERNAL_ERROR`，cause 不进入结果。
destination name 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`。`PushClient.destroy()` 幂等销毁全部
adapter，并禁止后续发送。

## 测试边界

core 测试覆盖模板 scanner、content 全字段渲染、渲染后校验、string/string array/AST
payload、shortcut attachment 前置与冲突、
payload/destination/options strict runtime 校验、base path 透传、default/具名/临时
target、string/object destination、异步 preparation、dry-run 无 dispatch 边界、signal
identity 与阶段顺序、prepare 后取消保留 request、receipt 统一组装、registry lifecycle、
错误归一化和 result target 规则。
构建输出保持 runtime-neutral ESM 与类型声明。
