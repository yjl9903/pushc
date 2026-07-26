# Pushc SKILL 编写规范

本文规定 `skills/pushc/` 的编写与审查方式，目标是让 Agent 能够正确配置和使用 pushc，
同时避免暴露无关实现细节、引导多余操作或产生行为歧义。

`docs/architecture/` 是行为事实来源。SKILL 负责把已经确定的公共行为转换成 Agent 可执行的
指引，不得自行定义、扩展或修正产品行为。

## 1. 内容分层

### `SKILL.md`

只保留每次触发后都需要的内容：

- 安装与配置检查流程。
- `targets` 和 `send` 的核心用法。
- 发送前确认、凭据保护、禁止自动重试等安全规则。
- 普通文本和结构化消息的推荐入口。
- 选择 CLI、configuration 和 adapter reference 的条件。

主文件可以保留完整的通用能力示例，但不得塞入 adapter 配置细节、完整输出 schema、
全部错误码或实现原理。

### `reference/cli.md`

记录 Agent 在需要精确行为时才加载的 CLI 公共约定：

- 命令和 option 语法。
- target、消息来源和配置发现规则。
- 消息文件格式、字段、路径解析和 option 交互。
- 用户可观察的 dry-run、输出和 exit status。

不要记录 Node library 的输入便利形式，除非 Agent 可以通过 CLI 直接使用。比如
`content: string`、`content: string[]` 是 library 调用能力，不应成为 Agent 创建结构化消息文件
的推荐格式。

### Adapter reference

每个 adapter reference 只描述：

- 必需配置和可选配置。
- target 的合法形态。
- 支持、忽略或拒绝的公共消息能力。
- 附件来源、限制、路径和 MIME 行为。
- dry-run 与真实发送的可观察差异。
- receipt、错误和重试风险。

通用章节不得假设所有 adapter 都支持 `title`、`param` 或附件。主文件在一个集中位置说明
能力差异，具体限制由 adapter reference 负责。

### `example/`

示例用于复制和改造，不用于解释内部设计：

- 保留所有有代表性的公共用法。
- 明确哪些值是凭据、哪些值可以直接写进配置。
- 只启用用户需要的 adapter。
- 有意保留的公共 schema 字段可以出现在示例中，即使当前只是空占位；不要因为当前行为少
  就擅自删除已经确定的后续公共接口。

## 2. Metadata 和触发描述

`description` 只负责说明何时触发 Skill，保持简短，不罗列内部能力：

```yaml
description: Use when the user asks to configure pushc or send a notification with pushc.
```

不要把某个具体命令或某类 target 写成触发条件。配置、发送过程中自然发生的校验和错误处理
也不需要单独扩张触发范围。

修改 `description` 后必须同步检查 `agents/openai.yaml`：

- `short_description` 与触发范围一致。
- `default_prompt` 使用相同的核心动作。
- 不在 UI metadata 中增加 SKILL 没有承诺的用途。

## 3. 面向 Agent 描述公共行为

### 使用确定性措辞

行为确定时使用 `overrides`、`merges`、`rejects`、`preserves` 等明确动词，不使用 `may`、
“可能替换”或其他会让 Agent 猜测的表达。

例如：

- CLI `--target` 覆盖消息文件中的 `target`。
- CLI `--title` 覆盖消息文件中的 `title`。
- CLI params 合并进消息文件的 `param`，重名键使用 CLI 值。
- 结构化消息文件与 `--attachment` 组合时直接拒绝。
- `.txt` 内容保留原始空白和换行。

不要创造新术语。使用“消息文件中的 target”，不要使用没有定义的 “document target”等名称。

### 描述可观察结果

Agent 需要知道输入、输出、约束和副作用，不需要知道内部调用链。优先写：

- “dry-run 校验并准备消息，但不发送。”
- “真实发送执行一次 HTTP 请求。”
- “模板替换只执行一次。”
- “连接失败时不要自动重试，远端可能已经收到消息。”

避免在 Agent 文档中出现与操作无关的实现词：

- core、normalize、AST。
- SDK、Fetch。
- scanner、dispatch、transport。
- adapter construction、initialization、resource lifecycle。
- 内部 hook、内部 payload 转换阶段。

平台公开概念或配置约束可以保留，例如 HTTP、WebSocket、MIME、QQ 私聊/群聊以及 receipt
中实际输出的 HTTP header。

### 区分校验与连通性

必须明确命令成功实际证明了什么：

- `pushc targets` 证明配置可以解析和校验，不证明平台可连接。
- dry-run 证明本地消息能够准备，不等于消息已发送。
- NapCat dry-run 只校验远程 URL 语法，不验证远程附件是否存在或可访问。
- Webhook dry-run 不调用 endpoint。

不要把正常输入形态描述成异常。可省略字段、空值等正常情况不需要被单独强调为特殊规则；
只有它会改变 Agent 的写法或决策时才说明。

## 4. 命令与示例

### 保留完整的通用用法

通用示例应覆盖 Agent 可能需要的公共入口：

- `pushc targets --json`。
- 基本文本发送。
- `--title`。
- 可重复的 `--param key=value`。
- 可重复的 `--attachment <source>`。
- `--dry-run`。
- `.txt` 消息文件。
- JSON 结构化消息文件。

示例覆盖完整能力不表示每个 adapter 都支持全部能力。只在一个集中位置提醒 Agent：
使用 `title`、`param` 或附件前读取所选 adapter 的 reference。

### 先介绍文本，再介绍结构化消息

普通发送优先使用位置正文或 `.txt`：

- 位置正文始终是字面文本。
- `.txt` 保留原始内容。
- 短消息不应为了“结构化”而创建消息文件。

之后再介绍结构化消息文件。结构化消息文件用于：

- 抽象可复用的通用消息模板。
- 精确控制 text/attachment 顺序。
- 指定附件名称和 MIME 等底层结构。

结构化示例优先使用 JSON 和有序 `content` 节点。TOML 只需在格式说明附近简短提及支持，
不要让 Agent 在没有需求时额外选择格式。

### 不引导多余操作

不要提供已有直接方式的绕路示例：

- 有文件时使用 `--file`，不要示范 `cat file | pushc send`。
- 不要求每次运行并报告版本。
- 不在 reference 中重复展示全局安装命令。
- 不发送未经用户要求的测试通知。
- 不添加 speculative target 或 unrelated adapter。
- 不展示不能使用的未来消息节点语法。

stdin 支持可以说明，但示例应来自真正的 pipe 场景，而不是把现有文件再经 `cat` 转发。

### 参数重复必须完整

可重复 option 的示例必须重复完整 option：

```bash
pushc send \
  --param group=deployments \
  --param environment=production \
  --attachment ./first.pdf \
  --attachment ./second.pdf \
  "Build completed"
```

不要写成看似一个 option 后跟多个裸值的形式。

## 5. 消息文件规则

Agent 创建结构化消息时使用一个消息对象和一个有序 `content` 数组，只展示公共节点：

- `text`
- `attachment`

必须清楚说明：

- 每个文件只描述一条消息。
- 文件可以提供默认 `target`。
- CLI target 覆盖文件 target。
- CLI title 覆盖文件 title。
- CLI params 与文件 param 合并，CLI 重名值优先。
- `--attachment` 不能与结构化消息文件组合。
- 文件内相对附件路径以消息文件目录为基准。
- stdin 中的相对附件路径以 cwd 为基准。

格式探测要描述结果，不解释 parser 内部状态：

- `.json`：JSON → TOML → text。
- `.toml`：TOML → JSON → text。
- `.txt`：只作为 text。
- 其他后缀、无后缀和 stdin：JSON → TOML → text。
- JSON 或 TOML 语法一旦解析成功，消息校验失败就直接报错，不回退成 text。

## 6. 配置与凭据

不要把消息字段写进 `config.toml`。配置根只描述实际配置 schema，不为 `param` 或其他消息字段
增加特殊接受、拒绝或迁移逻辑。

Agent 可以读取和编辑 `config.toml`，但敏感值在其中只能以环境变量占位符出现。以下内容必须
保存在环境变量或相邻 `.env` 中：

- token、key、password。
- 带凭据的 URL。
- 私有 endpoint。
- 私有 topic 等可能作为共享秘密的 destination value。

Agent 不得读取、打印或修改真实 `.env`。可以读取 `.env.example` 以识别变量名称，但不得把
placeholder 值复制成真实凭据。

不要因为某个值使用环境变量就自动把它称为秘密。公开 endpoint 和普通 destination ID 可以按
用户选择直接写入配置。

## 7. 输出与错误

只记录 Agent 会据此采取行动的输出规则：

- stdout、stderr 和 `--json` 的形态。
- dry-run 与真实发送的输出差异。
- exit status 的分类。
- adapter receipt 中对诊断有用且已脱敏的字段。
- 具有明确处理方式的错误码。

不要罗列没有解释、没有操作建议的内部错误码全集。若错误码需要写入 reference，应同时说明
它代表的用户可处理问题。

不要描述 client 销毁、资源回收、lazy acquisition 等退出实现。此类保证应留在架构文档和测试。

## 8. 安全与外部副作用

- 全局安装前必须取得用户同意。
- 真实发送必须有明确用户意图。
- 当 target 或消息由 Agent 推断时，发送前展示或概述二者。
- target 不明确时，从 `pushc targets` 结果中请用户选择。
- 不在命令、title、param 或附件 URL 中放置秘密。
- 不自动重试失败发送；失败可能发生在远端已接受消息之后。
- dry-run 不得被描述为真实连接测试或发送成功。

## 9. 修改流程

1. 先读取受影响的 `docs/architecture/`、实现和测试，确认真实公共行为。
2. 若行为发生变化，先消除 architecture、代码和测试之间的差异。
3. 按需更新 `SKILL.md`、对应 reference、example 和 `agents/openai.yaml`。
4. 搜索并删除旧术语、过时示例和兼容描述，不保留中间方案。
5. 检查主文件与 reference 对同一规则是否使用一致措辞。
6. 运行格式与基本验证。

建议至少运行：

```bash
pnpm exec prettier --check skills/pushc/SKILL.md skills/pushc/reference/*.md \
  skills/pushc/agents/openai.yaml
git diff --check -- skills/pushc
```

环境具备 skill validator 依赖时，再运行对应的 `quick_validate.py`。

## 10. Review checklist

### 触发与结构

- `description` 是否简短、只描述配置或发送的触发场景？
- `openai.yaml` 是否与 `description` 一致？
- 主文件是否只保留每次使用都需要的规则？
- 细节是否放入 Agent 会按条件读取的 reference？

### 清晰度

- 确定行为是否使用确定动词，而不是 `may`？
- target、title、param 和 attachment 的覆盖或冲突规则是否完整？
- 是否使用了未定义术语？
- 是否把校验成功误写成连接或发送成功？

### Agent 操作

- 示例是否展示最直接的 CLI 用法？
- 是否避免了重复安装、版本报告、无意义 pipe 和测试发送？
- 是否先介绍普通文本，再介绍结构化消息？
- 结构化示例是否只使用推荐的有序公共节点？
- adapter 不支持的能力是否引导到对应 reference？

### 实现边界

- 是否暴露 core、normalize、AST、SDK、Fetch 或生命周期等内部细节？
- adapter reference 是否只描述配置和可观察行为？
- 输出与错误说明是否能改变 Agent 的实际处理方式？
- 是否保留了没有解释价值的内部错误码或未来节点语法？

### 安全与一致性

- 是否阻止 Agent 读取或修改真实 `.env`？
- 示例是否避免凭据和私有 URL？
- 是否要求真实发送具有用户意图？
- architecture、实现、测试、SKILL 和 example 是否一致？
- Prettier、diff check 和可用的 skill validator 是否通过？
