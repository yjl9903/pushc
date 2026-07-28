# Webhook response assertions 实现计划

## 背景与目标

Webhook 当前只以 HTTP 200–299 判断成功；`response` 是严格空 table。不同上游还会通过
JSON body 或 response header 表达业务成功，因此本轮让 adapter 可以配置成功 status、JSON
body assertions 和 sanitized header assertions，同时保持 receipt 和未配置时的行为兼容。

## 关键决策

- `response.status` 接受 `"2xx"`、单个 status 或非空 status 数组，默认 `"2xx"`。
- `response.body` 是 JSON Pointer 到 assertion 的 table；`response.headers` 是 header name
  到 assertion 的 table。两者不再增加中间 `assertions` 层。
- assertion 必须显式使用 `{ equals = ... }` 或 `{ exists = ... }`；所有规则为 AND。
- target 的 `status`、`body`、`headers` 分别继承；显式 table 整组替换，空 table 清除。
- assertions 基于 response receipt 中可观察到的 JSON body 和 sanitized headers。纯文本
  response 和被过滤的 header 不可断言。
- status、body、headers 依次判断。失败返回 `SEND_FAILED` 并保留 response receipt，但错误
  message 不包含实际值或期望值。

## 技术方案

1. 扩展 Webhook response public types、严格配置解析和 target resolve。
2. 增加内部 `WebhookDispatchPlan`，把 request 与 resolved `responsePolicy` 一起传给
   dispatch，不改变公开 request receipt。
3. 实现 RFC 6901 JSON Pointer resolve、JSON 深比较、status 和 header assertion evaluator。
4. 更新 adapter、CLI smoke tests，以及 architecture、reference、README 和 pushc Skill 示例。
5. 运行 format、typecheck、CI tests 和 build。
