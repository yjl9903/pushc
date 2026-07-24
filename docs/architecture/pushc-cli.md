# `pushc` CLI 与组合层

## 定位

`apps/pushc` 负责配置发现、TOML/环境变量展开、adapter 组合、命令行输入与输出。它不实现
adapter 产品语义。`config.toml` 是可供 agent 阅读和修改的非敏感配置；秘密只通过
`${ENV_NAME}` 从进程环境或相邻 `.env` 注入。agent 不得读取、输出或修改 `.env`。

## 配置与初始化

配置从 `--config`、`PUSHC_CONFIG`、项目 `.pushc/config.toml`、XDG 与 home 路径依次发现。
app 层读取 TOML、由运行时加载相邻 `.env` 并递归展开 `${ENV_NAME}`；core 和 adapters
不访问文件或环境。

`makePushClient` 构造 adapter、注册具名 target、执行可选 initialize，再注册到 client。
任一步失败会销毁已创建资源并归一化为稳定配置错误。`targets` 只解析配置、初始化 adapter
并列出 destination；不构造 webhook request，也不发送测试消息。

## `pushc send`

```text
pushc send --target adapter[:target] \
  [--title <title>] [--param key=value ...] \
  [--file <path> | ...content]
```

`--target` string 原样交给 core client 解析。位置消息、`--file` 与 stdin 的现有优先级和冲突
规则不变。CLI 构造 `{ message, title?, param? }` payload，并调用
`client.send(destination, payload)`。

`--param [...entry]` 可重复出现。每项按第一个 `=` 分隔，key/value 不 trim；value 可以为空
或包含更多 `=`。key 必须匹配 `[A-Za-z0-9][A-Za-z0-9_.-]*`，同一次发送中按大小写敏感规则
拒绝重复 key。缺少 `=`、空/非法 key 或重复 key 为 `CLI_USAGE`，exit 2。param 只产生一层
string Record，不解析 JSON 或创建嵌套结构。

## 输出与错误

成功 text/JSON output 的外层格式保持现状；webhook receipt 为 `{ status }`，NapCat receipt
为 `{ messageId }`。配置、destination、payload、options 与 CLI usage 错误 exit 2；实际发送
失败 exit 1。错误输出不展示 resolved adapter/target 配置或秘密。destination 展示统一使用
core 的 `formatDestination`；CLI 不维护独立的 destination parser 或 formatter。每次命令在
成功和失败路径都销毁 client。

## 测试边界

测试覆盖配置发现与展开、adapter lifecycle、消息来源、`--title`/`--param` parsing、core
destination 委托、targets 无发送边界、text/JSON output 和 exit status。
