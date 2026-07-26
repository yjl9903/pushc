# pushc 系统架构

本文档是 pushc 当前能力、模块边界和架构约束的 ground-truth。功能或架构发生变化时，必须在同一次变更中更新本文档或本目录下对应的专题文档。

## 系统目标

pushc 提供面向用户和自动化 Agent 的消息推送能力：调用方通过 destination 发送 string、
string array 或有序 text/attachment AST，以及可选标题与一层 string param。core 将所有输入
归一化为唯一 AST。每个 adapter 实例保存可复用连接信息并
管理自己的 targets；target 是 adapter-specific partial config。系统当前支持通用 HTTP
Webhook，以及通过 NapCat WebSocket 发送 QQ 私聊、群聊、本地文件与 HTTP(S) 附件。

## 子项目索引

- [`apps/pushc`](./pushc-cli.md)：CLI、TOML 配置、消息输入、输出协议与官方 adapter 装配。
- [`packages/core`](./core.md)：公共领域模型、adapter 契约、发送调度与错误归一化。
- [`packages/adapter-webhook`](./adapter-webhook.md)：HTTP Webhook 配置、模板渲染、请求与取消语义。
- [`packages/adapter-napcat`](./adapter-napcat.md)：NapCat QQ 配置、连接生命周期、收件人与取消语义。

## 模块边界

- [`packages/core`](./core.md)：运行时无关的消息、target、adapter 和结果类型；负责 adapter registry、adapter 私有 target registry、发送调度和统一错误包装。
- [`packages/adapter-webhook`](./adapter-webhook.md)：基于标准 `fetch` 的运行时无关 adapter，
  支持完整 target 请求覆盖、JSON/文本 serializer、payload 模板、请求头和超时。
- [`packages/adapter-napcat`](./adapter-napcat.md)：Node.js adapter，管理 NapCat WebSocket 连接、私聊/群聊收件人、超时和发送回执。
- [`apps/pushc`](./pushc-cli.md)：Node.js CLI 与官方组合层；负责配置路径发现与标准化、异步配置加载、TOML 与环境变量、具体 adapter class 构造、消息输入、命令输出和退出码。

依赖方向必须保持为 `apps/pushc -> adapters -> core`。`core` 不得依赖 adapter、Node API、TOML 解析器或平台 SDK。adapter 不负责配置文件发现或 CLI 展示。

## 核心数据流

1. CLI 根据 cwd 与 `--config`/环境变量找到配置目录或文件，并标准化为配置文件路径。
2. Node 组合层加载 `.env` 和 TOML，按 `adapters.*.type` 直接构造官方 adapter。
3. 组合层把嵌套的具名 target partial 注册到对应 `adapter.targets`；没有具名 target 时解析并校验 adapter default，随后把 adapter 注册到 client。
4. CLI 从参数、文件或 stdin 读取消息，按后缀和 syntax 探测 JSON/TOML/text，形成 raw
   PushPayload 与可选 document target；CLI target 可覆盖 document target，CLI param 可按
   key 覆盖 document param。
5. client 解析 destination 并取得 adapter；base adapter 由 core 校验并 normalize payload，
   再将省略的 target、具名字符串或临时对象解析为具体 target，并异步完成仅限本地的 request
   preparation。
6. preparation 同时产生公开 receipt request 与内部 transport request。正常 send 进入
   `dispatchRequest` 并由 core 组合 receipt；dry-run 跳过 dispatch 和全部目标服务交互，
   返回固定带 `dryRun: true`、receipt 只含公开 request 的结果。
7. core 将 destination 上下文与 adapter result 合并为统一结果；CLI 将成功结果写入 stdout，
   将结构化错误写入 stderr，并映射退出码。

## 架构约束

- 新平台集成应作为独立 `packages/adapter-*` workspace，直接导出继承 `PushAdapter` 的 class；官方组合层按配置 type 调用其 constructor。
- 公共库保持 ESM、强类型且可独立测试；网络与平台边界必须可注入或 mock。
- workspace 内的 TypeScript 包名解析由根 `tsconfig.json` 直接指向各自 `src`；`package.json`
  中的 `dist` 入口只用于构建产物和发布。
- target 列表、日志和错误不得泄露 token、Webhook URL 等 adapter 私密配置。
- `dist/` 是构建产物，不作为设计或实现来源。
- 综合评估改动量与影响范围较大的需求，才在 `docs/plan/` 记录背景、目标、关键设计决策和技术方案；同一上下文优先复用已有 plan。plan 不能代替本目录的现状描述。

## JavaScript 运行时输入边界

公共 API 的运行时校验只面向 TypeScript 类型所描述的合理数据：object literal、JSON/TOML
parser 结果、普通 object、普通稠密 array 和标准平台对象。库负责校验业务可观察的字段、类型、
取值、未知字段以及 URL、路径、credentials、大小等外部边界，并把这些范围内的失败归一化为
稳定错误。支持 parser 结果不表示 parser 产生的标量对象可以充当 table；例如 TOML datetime
仍按标量处理，在要求普通 object、JSON object 或 table 的字段中必须被拒绝。

调用方负责在进入 pushc 前把数据物化为上述普通结构。稀疏 array、自定义 prototype、继承
字段、getter、Proxy、symbol key、通过普通 object 保存时与 `Object.prototype` 成员冲突的
动态 string key、运行期间并发 mutation、monkey-patched builtin 等 JavaScript corner case
不属于公共兼容性或安全承诺；实现不为它们增加专项分支或测试，也不保证它们的失败阶段和
错误码。代码评审不应仅为覆盖这些输入而增加复杂度。库在普通 object 上按动态 key 读取业务
字段时仍须检查字段类型，不能把缺失字段继承到的 `Object.prototype` 成员当成有效业务值。

## 文档维护

修改能力、数据流、公共接口、模块职责或依赖方向时，同步更新本目录。文档只描述当前有效设计；较大需求的设计背景与方案保留在 `docs/plan/`。若代码与架构文档不一致，应在继续实现前先明确并修正两者的偏差。
