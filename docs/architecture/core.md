# `@pushc/core`

## 定位与依赖

`packages/core` 是运行时无关的消息编排内核，没有运行时依赖。它定义 adapter 接入契约、adapter registry、adapter 私有 target registry 和发送调度。它不读取配置文件、不定义 TOML schema，也不认识具体平台或 adapter type。

## 源码职责

| 文件 | 职责 |
| --- | --- |
| `src/client.ts` | 无参数构造的 `PushClient`、adapter 选择、结果组装与错误归一化。 |
| `src/adapters.ts` | client 所属的 `PushAdapters` Map-like registry。 |
| `src/targets.ts` | adapter 所属的 `PushTargets`、partial 合并、注册模式与解析。 |
| `src/adapter.ts` | 保存连接配置并持有 targets 的 `PushAdapter` 抽象基类。 |
| `src/error.ts` | `PushError` 与 core 错误码。 |
| `src/types.ts` | 消息、发送上下文、结果和 client input。 |
| `src/utils/*` | 无副作用的名称、错误和值类型工具。 |

## Adapter 与 Target 契约

`PushAdapter<TConfig, TTarget, TReceipt>` 的 constructor 只接收已解析连接配置。实例公开只读 `config` 与 `targets`。base class 的公共 `send(input)` 统一解析 target 并校验消息；concrete adapter 实现 `parseTarget(input)` 与受保护的 `sendTarget(context)`，并可选实现异步 `initialize()` 与 `destroy()` lifecycle hooks。

`PushTargets<TTarget>` 持有所属 adapter，但不理解 target schema、默认字段或允许覆盖字段。registry 只保存具名 target；`register(name, partial)` 将 partial 原样交给 adapter 的 `parseTarget`。每个 concrete adapter 自行完成允许字段校验、顶层默认值浅合并和最终解析。同名注册返回 `DUPLICATE_TARGET`。

registry 提供 `size`、`get(name)`、`has(name)`、`delete(name)`、`clear`、`keys`、`values`、`entries`、`forEach` 和迭代器。default 与临时 target 不进入 registry；删除或清空具名 target 不影响 adapter 从顶层默认字段生成 default。

`PushAdapters.delete(name)` 与 `clear()` 是异步资源操作：先从 registry 移除实例，再等待对应 adapter 的可选 `destroy` hook。`clear()` 并行销毁快照中的全部 adapter；两者均将销毁失败归一化为 `DESTROY_FAILED`。`PushTargets` 不持有独立资源，其删除 API 保持同步。

## Client 与发送流程

`new PushClient()` 创建不可重新赋值的 `client.adapters = new PushAdapters()`。每个 target 始终由所属 adapter 管理。

client 与 adapter 的发送输入都支持三种 target 形式：省略时调用 `parseTarget({})` 生成 default；字符串引用 adapter registry 中的具名 target；对象作为匿名临时 partial 直接解析，不注册或缓存。

一次 `client.send({ adapter, target?, message, signal })`：

1. 校验 adapter 名称并从 `client.adapters` 查找实例；不存在时返回 `ADAPTER_NOT_FOUND`。
2. 调用 adapter 的公共 `send`；base adapter 校验非空消息与预取消 signal，再按上述三种语义解析 target。
3. 字符串名称非法返回 `INVALID_TARGET`，具名 target 不存在返回 `TARGET_NOT_FOUND`；default 或临时 partial 无法解析返回 `INVALID_CONFIG`。
4. concrete adapter 的 `sendTarget` 执行平台发送。
5. 返回 `{ adapter, target?, receipt }`；只有具名字符串 target 会出现在结果中。

普通发送异常包装为 `SEND_FAILED`；错误文本支持原生 `Error`、字符串以及带非空字符串
`message` 的 SDK 响应对象，无法提取文本时才回退为 `Unknown error`，原始异常保留为
`cause`。adapter 主动抛出的 `PushError` 原样透传。名称统一匹配
`[A-Za-z0-9][A-Za-z0-9_-]*`。

`PushClient.destroy()` 是幂等终止操作：并行调用所有已注册 adapter 的可选 `destroy` hook，并禁止后续发送。组合层在 adapter 完整注册前调用可选 `initialize` hook；初始化中途失败时销毁已经创建的资源。

## 测试边界

core 使用内存 adapter 覆盖 adapter 私有具名 targets、跨 adapter 同名、重复注册、Map-like API、default/具名/临时三种发送输入、未知 adapter/target、发送失败与取消。tsdown 输出 runtime-neutral ESM 与类型声明。
