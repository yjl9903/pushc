# `pushc` CLI 与组合层

## 定位

`apps/pushc` 负责配置发现、TOML/环境变量展开、adapter 组合、命令行输入与输出。它不实现
adapter 产品语义。`config.toml` 是可供 agent 阅读和修改的非敏感配置；秘密只通过
`${ENV_NAME}` 从进程环境或相邻 `.env` 注入。agent 不得读取、输出或修改 `.env`。

## 配置与初始化

配置从 `--config`、`PUSHC_CONFIG`、项目 `.pushc/config.toml`、XDG 与 home 路径依次发现。
app 层读取 TOML、由运行时加载相邻 `.env` 并递归展开 `${ENV_NAME}`；core 和 adapters
不访问文件或环境。展开只递归遍历 TOML table 与 array；datetime 等 parser 标量保持原值，
交给对应配置字段的语义校验。

`makePushRuntime(options)` 统一完成配置发现、加载、adapter 构造和具名 target 注册，并返回
`{ success: true, client, redactions }` 或 `{ success: false, error, redactions }`。任一步失败会
销毁已创建资源；CLI 不重复配置路径模板。adapter 不提供主动初始化阶段，需要连接等资源时在
首次真实发送中惰性获取。`targets` 只解析配置并列出 destination；不构造 webhook request，也
不建立 NapCat 连接或发送测试消息。

## `pushc send`

```text
pushc send --target adapter[:target] \
  [--title <title>] [--param key=value] [--attachment <source>] \
  [--dry-run] [--file <path> | ...content]
```

CLI 将位置参数、`--file` 或 stdin 解析成
`{ target?, payload: PushPayload, basePath? }`，不生成 AST；core 负责后续
normalize。位置参数始终按空格连接为 literal string。`--file` 与位置参数互斥，有 `--file`
时不读取 stdin。

输入实现完整收敛在 `src/input/`：`index.ts` 编排消息来源、CLI 覆盖和最终 payload；
`src/input/message.ts` 负责格式探测、结构化文档提取及 attachment 路径上下文；
`src/input/params.ts` 负责把 `--param` entry 解析、合并为 Map。所有 CLI、配置和消息输入错误类型、归一化、
脱敏输出与退出码映射统一位于 `src/error.ts`。

文件按大小写不敏感后缀选择解析顺序：`.json` 为 JSON/TOML/text，`.toml` 为 TOML/JSON/text，
`.txt` 固定 text，其他或无后缀为 JSON/TOML/text。stdin 没有后缀，使用 JSON/TOML/text；
空白输入直接视为 text。JSON/TOML 只有 syntax error 才进入下一个 parser；syntax success 后
固定格式，文档或 core payload 校验失败不得 fallback 成 text。结构化根对象取出可选 target，
其余字段形成 PushPayload；消息文件的 param table 在此边界转换为 Map，attachment node 的
`media_type` 映射为 `mediaType`。

结构化文件或 stdin 可提供默认 target，CLI `--target` 覆盖它；没有有效 target 时失败。
CLI `--title` 覆盖结构化消息中的 title；CLI `--param` 按 key 覆盖结构化消息中的 param，
未覆盖 key 保留。结构化输入独占 attachments，与 CLI `--attachment` 混用为 `CLI_USAGE`。
text 输入继续允许 CLI title/param/attachments；CLI 不改写 attachment source，而是在消息
含有 attachment 时提供绝对 `basePath`。结构化文件以消息文件目录为 base，
stdin 和 CLI attachment 以 cwd 为 base。core 完成模板渲染后，adapter 根据最终 source
区分 URL、绝对路径与相对路径；只有相对本地路径使用该 base。消息顺序由 core normalize。
CLI 不渲染消息模板。core 使用 CLI 覆盖后的最终 title/param 渲染所有 content 输入；
结构化消息中 text 的 `text` 与 attachment 的 `source`、`name`、`media_type` 均可使用
`{{title}}` 和 `{{param.key}}`。

`--dry-run` 调用
`client.send(destination, payload, { dryRun: true, basePath? })`。普通 send 同样传递可选
base path。它仍完成配置、target、payload 和 adapter 本地 preparation，包括
本地附件读取与编码以及远程 URL 校验，但不下载远程附件、不执行 `dispatchRequest` 或任何
目标服务交互。结果固定包含 `dryRun: true`；`success` 只表示 request 是否准备成功。正常
send 结果不增加 dryRun 字段。

`--param key=value` 可重复出现，每个 entry 都必须完整重复一次 option。每项按第一个 `=`
分隔，key/value 不 trim；value 可以为空或包含更多 `=`。key 必须匹配
`[A-Za-z0-9][A-Za-z0-9_.-]*`，同一次发送中按大小写敏感规则拒绝重复 key。缺少 `=`、空/非法
key 或重复 key 为 `CLI_USAGE`，exit 2。param 只产生一层 string Map，不解析 JSON 或创建
嵌套结构。结构化消息已有 param 时，CLI param 按 key 覆盖它并产生新的 Map。

## 输出与错误

send JSON 直接输出完整统一 `PushResult`；其他错误输出 `{ success: false, error }`，
targets 成功输出 `{ success: true, targets }`。普通文本成功为
`Send succeeded: adapter[:target]`，summary 另起 `Summary:` 行；失败为
`Send failed: adapter[:target]` 与 `Error:` 行，无可信 destination 时只输出 `Error:`。
不使用 `pushc:` 前缀。

dry-run JSON 直接输出完整 `PushDryRunResult`。普通文本成功为
`Dry run ready: adapter[:target]`，随后用缩进 JSON 输出 `Request:`；失败为
`Dry run failed: adapter[:target]` 与 `Error:`，请求已生成时同时保留
`receipt: { request }`。dry run 成功写 stdout，失败写 stderr，退出码沿用 send 的错误码映射。

配置加载收集 TOML 中实际 `${NAME}` 引用的非空环境变量值、完成替换后的配置字符串，以及
它们经 trim、URL 编码和完整 URL 规范化后的形式。CLI 在 text/JSON 输出前复制输出对象，按值
长度降序把所有 string value 中的命中替换为 `[REDACTED]`；有限 number 的十进制字符串与
某个跟踪值完全相等时也替换，以覆盖 adapter 的数字规范化。Node API 返回未脱敏的完整
receipt。未被配置引用的环境变量不参与扫描。destination 展示统一使用 core 的
`formatDestination`；每次命令在成功和失败路径都销毁 client。

## 测试边界

测试覆盖配置发现与展开、adapter lifecycle、JSON/TOML/text 后缀与 stdin 探测、syntax
fallback/schema no-fallback、消息来源、`--title`/`--param` parsing、CLI/core normalize
边界、core destination 委托、dry-run 无网络边界、targets 无发送边界、text/JSON output 和
exit status。
