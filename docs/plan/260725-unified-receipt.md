# 统一消息发送回执

## 背景与目标

旧回执混合了平台数据与发送状态，CLI 需要检查 `receipt.success`，发送前错误又使用另一套
JSON 格式。本次将 Receipt 收敛为 adapter 平台数据，将 success/error 提升到 `PushResult`
顶层，使 Node API 和 CLI send 共用一个结果协议。

## 关键决策

- Receipt 只保存 `{ request, response?, summary? }`，不包含 success/error。
- `PushResult` 是顶层判别联合；所有预期发送错误都返回 `success: false`，不再抛出。
- adapter send result 承载 receipt/error，client 合并 adapter、具名 target 和 result。
- NapCat 记录 `send_msg` 和完整 params。Webhook 记录完整最终请求，JSON body 保留序列化前
  的值；HTTP 200–299 成功。
- Webhook response 记录 status、过滤常见鉴权字段后的 headers，并 best-effort 解析 JSON。
- NapCat summary 记录 user/group、收件人 ID 和 message ID；Webhook summary 记录 method、
  host 和 HTTP status。
- adapter/Node API 回执不脱敏；CLI 追踪配置实际引用的环境变量及其 trim、编码、URL 规范化
  衍生值，并替换为 `[REDACTED]`。
- 直接替换旧 receipt，不保留兼容字段。
- CLI send JSON 直接输出完整脱敏 `PushResult`；其他命令也统一使用顶层 `success/error`。
- 纯文本使用 `Send succeeded/failed`、独立 `Summary/Error` 行，不使用 `pushc:` 前缀。

## 技术方案

core 定义纯 `PushReceipt`、adapter send result 和顶层 `PushResult`。`PushAdapter.send`
把 payload/options/target 错误转换为失败 result；`PushClient.send` 逐步保留可信
adapter/target，并把所有预期错误归一化为失败 `PushResult`。`makePushRuntime` 继续统一
配置发现和 client 构造，CLI 将其错误转换为同一顶层失败形状。
