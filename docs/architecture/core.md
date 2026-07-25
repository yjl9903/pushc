# `@pushc/core`

## 定位与依赖

`packages/core` 是运行时无关的消息编排内核。它依赖 Zod 完成公共发送边界校验，但不依赖
Node API、TOML parser、platform SDK 或任何 concrete adapter。它定义 adapter 接入契约、
adapter registry、adapter 私有 target registry 和发送调度。

## 公共发送模型

正文、公共消息字段与发送控制分离：

```ts
interface PushPayload {
  readonly message: string;
  readonly title?: string;
  readonly param?: Readonly<Record<string, string>>;
}

interface PushSendOptions {
  readonly signal?: AbortSignal;
}

type PushTargetInput = string | Readonly<Record<string, unknown>>;
type PushDestination = string | { readonly adapter: string; readonly target?: PushTargetInput };
```

adapter 使用 `send(target, payload, options?)`；client 使用
`send(destination, payload, options?)`。string destination 格式为 `adapter[:target]`，只允许
零个或一个冒号。object destination 为 strict object，target 可以是具名 string 或临时配置
object。

payload 为 strict object。`message` 必须是 trim 后非空的 string，但保留原始内容；`title`
为可选 string，空 string 合法；`param` 为可选 plain object，value 全部为 string，key 匹配
`[A-Za-z0-9][A-Za-z0-9_.-]*`。归一化后的非空 param 是冻结的 null-prototype copy，缺省
param 保持 `undefined`。payload 错误为 `INVALID_MESSAGE`。

options 为 strict object。signal 使用 runtime-neutral shape guard 校验 `aborted`、
`addEventListener` 和 `removeEventListener`，保持原 identity；options 错误为
`INVALID_SEND_OPTIONS`。payload/options 校验后立即检查预取消 signal，失败为
`SEND_FAILED`，且不得继续解析 target。

## Adapter 与 Target 契约

`PushAdapter<TConfig, TTarget, TReceipt>` 保存只读 `config` 与 `targets`。base class 的公共
`send(target, payload, options?)` 完成公共 input normalization，然后调用：

```ts
protected abstract sendTarget(
  target: TTarget,
  payload: PushPayload,
  options: Readonly<PushSendOptions>
): Promise<PushAdapterSendResult<TReceipt>>;
```

三个参数分别是 resolved `target`、normalized `payload` 和 normalized `options`，与公共
send 的语义顺序一致。concrete adapter 实现 `parseTarget(input)`，负责 adapter default、
partial merge 和 adapter-specific 校验。

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
`{ success: true, adapter, target?, receipt }`；失败包含
`{ success: false, adapter?, target?, receipt?, error }`。Receipt 只保存 adapter-specific
`{ request, response?, summary? }`，且必须可序列化。adapter outcome 先组合 receipt/error，
client 按 success/failure 分支显式构造结果，只复制协议规定的字段，再合并逐步解析出的
adapter 和具名 string target；outcome 的其他顶层字段不进入 PushResult。所有预期发送错误均
返回失败 result。
adapter name 和 target name 统称 destination name，使用同一套格式规则；
`formatDestination(adapter, target?)` 由 core 统一把 destination 格式化为
`adapter[:target]`。destination 的名称校验、输入归一化和格式化聚合在
`utils/destination.ts`；名称正则是内部实现，不属于公共 API。

adapter 和 client 将 `PushError` 的 code/message 写入失败结果；意外 adapter 异常归一化
为 `SEND_FAILED`，无法进入 adapter 阶段的意外异常为 `INTERNAL_ERROR`，cause 不进入结果。
destination name 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`。`PushClient.destroy()` 幂等销毁全部
adapter，并禁止后续发送。

## 测试边界

core 测试覆盖 payload/destination/options strict runtime 校验、default/具名/临时 target、
string/object destination、signal identity 与预取消顺序、registry lifecycle、错误归一化和
result target 规则。构建输出保持 runtime-neutral ESM 与类型声明。
