# `pushc` CLI 与 Node 组合层

## 定位与边界

`apps/pushc` 是 Node.js 24+ CLI 和官方 adapter 组合层。它负责配置路径、文件 I/O、TOML 根 schema、环境变量、具体 adapter class 选择、target 装配、CLI 地址、消息输入和输出；core 不理解 TOML 或 `adapter[:target]`。

## 配置与初始化

配置根只允许 `adapters`：

```toml
[adapters.qq]
type = "napcat"
base_url = "ws://127.0.0.1:3001"

[adapters.qq.targets.ops]
group_id = "123456"
```

`parsePushConfig` 将每个 adapter 解析为 `{ type, options, targets }`。`options` 是除 `type` 和 `targets` 外的顶层字段；`targets` 是具名 partial tables。adapter 和 target 名称必须匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`。根级额外字段和非法结构返回 `INVALID_CONFIG`。

`makePushClient(configFilePath)` 从主配置同目录加载 `.env`，解析 TOML，创建空 client，并对每个 definition：

1. 按 `type` 直接调用具体 adapter constructor，传入 `options`。
2. 若存在具名 targets，逐个调用 `adapter.targets.register`；否则解析一次 adapter default 以验证配置，但不注册或缓存。
3. target 校验完成后调用 adapter 的可选 `initialize` hook，再调用 `client.adapters.register`。
4. 任一 adapter 初始化失败时调用当前 adapter 及 client 的 `destroy`，避免遗留部分资源。

`findConfigPath` 按以下顺序发现配置：显式 `--config`、`PUSHC_CONFIG`、
`<cwd>/.pushc/config.toml`、`$XDG_CONFIG_HOME/pushc/config.toml`、
`~/.config/pushc/config.toml`。显式选项和环境变量仍可指向配置文件或包含
`config.toml` 的目录；自动发现路径只接受对应的常规文件。

## CLI 地址与输出

发送命令为 `pushc send [...content] --target <adapter[:target]>`。`--target` 必填；地址只能包含一个可选冒号，两段分别应用公共名称规则。省略冒号表示匿名 default，不会回退到唯一具名 target。

`pushc targets` 遍历 `client.adapters` 及每个 `adapter.targets`。JSON 列表项仅为
`{ adapter, target? }`；JSON 发送结果直接使用 core 的 `PushResult` 字段并增加
`ok`，不重复返回拼接后的目标字符串。普通文本将 adapter 与可选 target 格式化为
`adapter[:target]`，并只附带非敏感 receipt 摘要，不读取 URL、token 或 target options。

每个 sub-command action 都在 `finally` 中调用 `client.destroy()`，确保 NapCat 等持久连接不会阻止 CLI 进程退出。库调用方通过 `makePushClient` 获得 client 后自行负责 destroy。

`.env` 优先级、消息参数/文件/stdin、JSON 错误和退出码保持现有行为。

## Agent Skill

面向终端用户的 `pushc` Skill 位于仓库根目录 `skills/pushc`，不随 npm 包发布。
`SKILL.md` 只保留安装/版本/连通性前序检查、按需配置和命令摘要；完整配置 schema 与 CLI
行为分别放在 `reference/configuration.md` 和 `reference/cli.md`，由 agent 按任务需要加载。

## 测试边界

Vitest 覆盖配置 schema、名称限制、target 装配与原子失败、地址解析、必填 `--target`、default/具名查找、结构化列表、密钥隐藏和构建后 CLI smoke test。
