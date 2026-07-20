# Target 发送输入重构

## 背景与目标

当前 `PushClient.send` 只能通过已注册 target name 发送，直接使用 adapter 时还需要先调用
`parseTarget` 或 target registry。公共 API 应直接表达调用意图，并隐藏已解析 target 的内部形态。

发送时的 `target` 统一支持三种形式：

1. 省略：由 adapter 使用其顶层 target 默认字段即时生成 default target。
2. 字符串：引用该 adapter 下已经注册的具名 target。
3. 对象：作为不注册、不缓存的匿名临时 target partial，由 adapter 即时解析。

## 关键决策

- `PushAdapter.send` 成为公共解析入口；concrete adapter 改为实现只接收已解析 target 的
  `sendTarget`。
- `PushTargets` 只存储具名 targets；default 不再占用 `undefined` key，也不再需要
  `registerDefault()`。
- 临时 target 和 default 都调用 concrete adapter 的同一个 `parseTarget`，因此继承相同顶层默认字段，且执行相同的连接字段与未知字段校验。
- `PushResult.target` 只在调用方传入具名 target 字符串时返回；default 与临时 target 都是匿名的。
- 配置没有具名 targets 时，组合层在初始化期间解析一次 default 以尽早报告无效配置，但不注册或缓存它。

## 技术方案

- 新增共享 target input 和 adapter send input 类型。
- 在 base adapter 中完成消息、取消状态和 target 输入解析，再调用 `sendTarget`。
- client 只负责 adapter 查找、adapter 级发送调用、结果组装和发送异常归一化。
- CLI 的 `targets` 命令在 adapter 没有具名 targets 时输出其 default 标识；具名 targets 仍从 registry 遍历。
- 更新 core、官方 adapters、组合层测试及所有 README 示例，示例优先展示临时 target 对象。
