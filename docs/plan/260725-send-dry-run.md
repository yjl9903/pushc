# Send 最终请求 Dry Run

> 当前 adapter preparation/dispatch 契约已由
> [`260725-attachments-and-request-lifecycle.md`](./260725-attachments-and-request-lifecycle.md)
> 取代；本文保留最初引入
> dry-run 的背景。

## 背景与目标

`pushc send` 需要在不触发平台调用的前提下检查最终消息内容。只打印 CLI payload 无法覆盖
Webhook 模板渲染、NapCat 收件人转换等 adapter 语义，因此 dry run 必须生成真实发送前使用的
最终 request。

## 关键决策

- `--dry-run` 完成配置、destination、target、payload 和最终 request 校验，但不获取发送资源
  或执行网络操作。
- Dry-run 结果保留 `success` 判别字段，并固定包含 `dryRun: true`；正常发送结果保持不变。
- `PushSendOptions` 增加 `dryRun?: boolean`，不新增独立 preview 方法。
- Adapter 把同步纯函数 `prepareRequest` 与异步 `sendRequest` 分离，dry run 和真实发送共用同一
  request 构造路径；`dryRun: true` 时不调用 `sendRequest`。
- Dry-run 沿用 receipt 层级，其中只包含 adapter-specific request，不包含 response 或发送
  summary。
- CLI 继续使用现有环境变量衍生值追踪与递归脱敏。
- 直接替换旧 `sendTarget` protected 契约，不保留兼容层。

## 技术方案

Core 增加 dry-run 结果类型，并在 adapter/client 的现有 `send()` options 上增加 `dryRun`。
base adapter 负责公共 payload 和 target 校验，再调用 `prepareRequest`；正常发送将生成的
request 传给 `sendRequest`，dry run 则返回 `receipt: { request }`。adapter 不提供主动初始化
阶段，需要连接时由真实发送惰性获取。文本输出展示格式化 request，JSON 输出完整
`PushDryRunResult`，退出码和错误流沿用 send 规则。
