# pushc 系统架构

本文档是 pushc 当前能力、模块边界和架构约束的 ground-truth。功能或架构发生变化时，必须在同一次变更中更新本文档或本目录下对应的专题文档。

## 系统目标

pushc 提供面向用户和自动化 Agent 的消息推送能力：调用方将文本消息发送到具名 target，target 选择 adapter 并携带其配置。系统当前支持通用 HTTP Webhook，以及通过 NapCat WebSocket 发送 QQ 私聊和群聊消息。

## 模块边界

- `packages/core`：运行时无关的消息、target、adapter 和结果类型；负责 adapter 注册、输入校验、配置解析调用、发送调度和统一错误包装。
- `packages/adapter-webhook`：基于标准 `fetch` 的运行时无关 adapter，支持 JSON/文本请求体、`{{message}}` 替换、请求头和超时。
- `packages/adapter-napcat`：Node.js adapter，管理 NapCat WebSocket 连接、私聊/群聊收件人、超时和发送回执。
- `apps/pushc`：Node.js CLI 与官方组合层；负责 TOML 配置发现、环境变量展开、消息输入、命令输出和退出码。

依赖方向必须保持为 `apps/pushc -> adapters -> core`。`core` 不得依赖 adapter、Node API、TOML 解析器或平台 SDK。adapter 不负责配置文件发现或 CLI 展示。

## 核心数据流

1. CLI 从参数、文件或 stdin 读取消息，并加载 TOML target 配置。
2. CLI 将 target 与消息交给 `PushClient`。
3. core 按 target 的 adapter 名称查找实现，并调用 adapter 的 `parseConfig`。
4. adapter 执行平台发送并返回 receipt；core 生成统一 `PushResult`。
5. CLI 将成功结果写入 stdout，将结构化错误写入 stderr，并映射退出码。

## 架构约束

- 新平台集成应作为独立 `packages/adapter-*` workspace 实现 `PushAdapter`。
- 公共库保持 ESM、强类型且可独立测试；网络与平台边界必须可注入或 mock。
- target 列表、日志和错误不得泄露 token、Webhook URL 等 adapter 私密配置。
- `dist/` 是构建产物，不作为设计或实现来源。
- 需求背景、目标、关键设计决策和技术方案记录在 `docs/plan/`，不能代替本目录的现状描述。

## 文档维护

修改能力、数据流、公共接口、模块职责或依赖方向时，同步更新本目录。文档只描述当前有效设计；需求的设计背景与方案保留在 `docs/plan/`。若代码与架构文档不一致，应在继续实现前先明确并修正两者的偏差。
