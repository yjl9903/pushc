# Webhook 手机推送服务参考

本文整理可通过 HTTP 请求向手机通知中心推送消息的服务，作为通用 `webhook` adapter
的配置参考。当前第一批覆盖 Bark、ntfy、Gotify 和 Pushover；它们不会拥有独立 adapter。

本文所称：

- **固定字段**：完成一次基础推送必须提供的鉴权、目标和消息字段。
- **扩展字段**：服务支持但基础推送不需要的通知样式、优先级、动作和生命周期字段。
- **请求字段名**：均为上游服务的原始字段名，pushc 不重命名或统一其语义。

上游接口可能发生变化。以下内容最后核对于 2026-07-22，配置前应同时参考各服务的官方文档。

## 通用 adapter 配置形态

四个服务的基础发送都能归一为一次 HTTP 请求：

| 能力                   | 用途                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `url`                  | 配置静态可信服务端地址，并确定允许请求的 origin。                             |
| `request.url`          | 可选动态 endpoint；未配置时使用顶层 `url`。                                   |
| `request.method`       | 本批服务使用 `POST`；ntfy 也接受 `PUT`。                                      |
| `request.headers`      | 配置 Bearer Token、服务专用 Token 及其他请求 header。                         |
| `request.content_type` | 使用标准 media type 选择请求体编码，如 `application/json` 或 `text/plain`。   |
| `request.body`         | 保留服务原始字段，并在任意字符串值中插入 `{{message}}`。                      |
| `request.timeout_ms`   | 限制请求等待时间。                                                            |
| `response`             | 空配置占位；receipt 始终记录 status、过滤后的 headers，并尽力解析 JSON body。 |

`config.toml` 是允许 agent 阅读的明文，不得包含任何真实秘密。Token、key、password 和
其他 credential 必须放在配置文件旁的 `.env` 或进程环境中，`config.toml` 只通过
`${ENV_NAME}` 引用。adapter 默认 URL 是不参与发送时渲染的静态可信 endpoint；只有 target
或 adapter 的 `request.url`（包括 query）、header value 和 body string value 可以通过模板
引用 `{{message}}`、`{{title}}` 与 `{{param.key}}`。`request.url` 必须是包含 scheme 的绝对
HTTP(S) URL，并与顶层 `url` 同 origin，不支持相对 URL。其余字段原样传给上游服务。
本文配置示例按照 [Webhook adapter 优化计划](../plan/260722-webhook-optimization.md)中的预期
配置形态描述。

## 能力总览

| 服务     | 推荐请求                     | 固定字段                   | 认证位置                  | 主要扩展能力                                       |
| -------- | ---------------------------- | -------------------------- | ------------------------- | -------------------------------------------------- |
| Bark     | `POST /push` JSON            | `device_key`、`body`       | JSON body                 | 中断级别、声音、图标、分组、跳转、更新/删除        |
| ntfy     | `POST /` JSON                | `topic`、`message`         | 可选 Authorization header | 优先级、标签、Markdown、附件、动作、延迟、更新     |
| Gotify   | `POST /message` JSON         | `message`                  | `X-Gotify-Key` header     | 标题、优先级、Markdown、跳转、大图、Android Intent |
| Pushover | `POST /1/messages.json` JSON | `token`、`user`、`message` | JSON body                 | 设备、优先级、声音、TTL、紧急确认、图片、加密      |

## Bark

### 请求方式

推荐使用 JSON endpoint。它将设备 key 放进 body，避免在 URL path 中拼接密钥：

```http
POST https://api.day.app/push
Content-Type: application/json

{
  "device_key": "<device-key>",
  "body": "Build completed"
}
```

Bark 也接受以下形式，但不作为 pushc 的推荐配置：

- `GET /<key>/<body>`、`GET /<key>/<title>/<body>`；
- `POST /<key>` 搭配表单或 JSON body；
- JSON `device_keys` 批量推送。

自托管时只需把 `https://api.day.app` 替换为自己的 Bark Server 地址。

### 固定字段

| 字段         | 类型   | 说明                                              |
| ------------ | ------ | ------------------------------------------------- |
| `device_key` | string | 目标设备 key；使用 `/push` JSON endpoint 时需要。 |
| `body`       | string | 通知正文，通常映射 `{{message}}`。                |

如果使用 `device_keys` 批量发送，它替代 `device_key`，值为 string array。使用 `markdown`
时服务会忽略 `body`，但为了保持基础配置直接，推荐仍以 `body` 作为正文入口。

### 扩展字段

| 字段          | 类型          | 说明                                                 |
| ------------- | ------------- | ---------------------------------------------------- |
| `title`       | string        | 通知标题。                                           |
| `subtitle`    | string        | 通知副标题。                                         |
| `markdown`    | string        | Markdown 正文；设置后忽略 `body`。                   |
| `device_keys` | string[]      | 批量目标设备 key，仅 JSON 请求支持。                 |
| `level`       | string        | `critical`、`active`、`timeSensitive` 或 `passive`。 |
| `volume`      | number        | Critical Alert 音量，范围 0–10。                     |
| `badge`       | number        | App 图标角标。                                       |
| `call`        | string/number | 设为 `1` 时重复铃声。                                |
| `autoCopy`    | string/number | 复制行为开关。                                       |
| `copy`        | string        | 指定复制内容。                                       |
| `sound`       | string        | 通知铃声。                                           |
| `icon`        | string        | 自定义图标 URL。                                     |
| `image`       | string        | 通知图片 URL。                                       |
| `group`       | string        | 通知分组。                                           |
| `ciphertext`  | string        | 加密推送的密文。                                     |
| `isArchive`   | string/number | 是否保存到 Bark 历史。                               |
| `ttl`         | number        | 已归档消息保留秒数。                                 |
| `url`         | string        | 点击通知后打开的 URL、URL Scheme 或 Universal Link。 |
| `action`      | string        | `alert` 会在打开 App 后显示动作弹窗。                |
| `id`          | string        | 相同 ID 用于更新已有通知。                           |
| `delete`      | string/number | 与 `id` 一起使用，设为 `1` 时删除通知。              |

### pushc 配置示例

```toml
[adapters.bark]
type = "webhook"
url = "https://api.day.app/push"

[adapters.bark.request]
method = "POST"
content_type = "application/json"

[adapters.bark.request.body]
device_key = "${BARK_DEVICE_KEY}"
body = "{{message}}"
title = "{{title:-pushc}}"
group = "pushc"
level = "active"
```

官方资料：[Bark API tutorial](https://github.com/Finb/Bark/blob/master/docs/en-us/tutorial.md)

## ntfy

### 请求方式

ntfy 支持两种适合通用 adapter 的主要形式。

最简单的是把消息作为 text body 发到 topic URL，其他参数放进 headers：

```http
POST https://ntfy.sh/<topic>
Title: pushc
Priority: high
Tags: white_check_mark
Content-Type: text/plain

Build completed
```

为了让 topic 和扩展字段都处于可递归配置的 body 中，pushc 推荐使用 JSON publish：

```http
POST https://ntfy.sh/
Content-Type: application/json

{
  "topic": "<topic>",
  "message": "Build completed",
  "title": "pushc",
  "priority": 4
}
```

受保护 topic 推荐使用 `Authorization: Bearer <token>`；ntfy 也支持 Basic Auth 和
`auth` query 参数。自托管时替换 host 即可。公开 topic 名本身近似共享密钥，应使用难以猜测
的 topic，或者启用访问控制。

### 固定字段

| 字段      | 类型   | 说明                                                                    |
| --------- | ------ | ----------------------------------------------------------------------- |
| `topic`   | string | JSON publish 的目标 topic；向 `/<topic>` 发送 text body 时由 URL 提供。 |
| `message` | string | 通知正文，通常映射 `{{message}}`；省略时服务默认使用 `triggered`。      |

### JSON 扩展字段

| 字段          | 类型     | 说明                                               |
| ------------- | -------- | -------------------------------------------------- |
| `title`       | string   | 通知标题。                                         |
| `tags`        | string[] | 标签或可映射为 emoji 的名称。                      |
| `priority`    | number   | 1–5，3 为默认值。                                  |
| `actions`     | array    | 通知操作按钮，如打开 URL、发 HTTP 请求或复制内容。 |
| `click`       | string   | 点击通知后打开的 URL。                             |
| `attach`      | string   | 远程附件 URL。                                     |
| `markdown`    | boolean  | 将 `message` 作为 Markdown。                       |
| `icon`        | string   | 通知图标 URL。                                     |
| `filename`    | string   | 附件展示文件名。                                   |
| `delay`       | string   | 延迟时间或发送时间，例如 `30min`、`9am`。          |
| `email`       | string   | 同时发送邮件；可为地址或 `yes`。                   |
| `call`        | string   | 同时发起电话通知；可为号码或 `yes`。               |
| `sequence_id` | string   | 更新、清除或删除通知所使用的序列 ID。              |

### Header/query 扩展字段

text body 形式可以通过 header 提供同类参数：`X-Title`、`X-Priority`、`X-Tags`、
`X-Delay`、`X-Actions`、`X-Click`、`X-Attach`、`X-Markdown`、`X-Icon`、
`X-Filename` 和 `X-Sequence-ID`。常见控制字段还有：

| Header          | 说明                                  |
| --------------- | ------------------------------------- |
| `Authorization` | Basic 或 Bearer 认证。                |
| `X-Cache`       | 设为 `no` 时不在服务端缓存。          |
| `X-Firebase`    | 设为 `no` 时禁止转发到 Firebase。     |
| `Content-Type`  | `text/markdown` 可直接启用 Markdown。 |

### pushc 配置示例

```toml
[adapters.ntfy]
type = "webhook"
url = "https://ntfy.sh/"

[adapters.ntfy.request]
method = "POST"
content_type = "application/json"
headers = { Authorization = "Bearer ${NTFY_TOKEN}" }

[adapters.ntfy.request.body]
topic = "${NTFY_TOPIC}"
message = "{{message}}"
title = "{{title:-pushc}}"
priority = 4
tags = ["white_check_mark"]
```

不需要认证时应删除 `Authorization`。官方资料：
[ntfy publishing](https://docs.ntfy.sh/publish/)。

## Gotify

### 请求方式

向 Gotify 实例的 `/message` endpoint 发送 JSON，Application Token 推荐放在
`X-Gotify-Key` header：

```http
POST https://push.example.com/message
X-Gotify-Key: <application-token>
Content-Type: application/json

{
  "message": "Build completed",
  "title": "pushc",
  "priority": 5
}
```

Token 也可以放在 `token` query 参数或 `Authorization: Bearer <token>` 中。Header 形式
最容易统一管理和脱敏。

### 固定字段

| 字段           | 位置      | 类型   | 说明                                         |
| -------------- | --------- | ------ | -------------------------------------------- |
| `X-Gotify-Key` | header    | string | Application Token。                          |
| `message`      | JSON body | string | 唯一必填的消息字段，通常映射 `{{message}}`。 |

### 扩展字段

| 字段       | 类型   | 说明                                                    |
| ---------- | ------ | ------------------------------------------------------- |
| `title`    | string | 通知标题。                                              |
| `priority` | number | 客户端展示优先级；较高值通常触发更显著的 Android 通知。 |
| `extras`   | object | 客户端展示和行为扩展。                                  |

常用 `extras`：

| 路径                                  | 类型   | 说明                                                |
| ------------------------------------- | ------ | --------------------------------------------------- |
| `client::display.contentType`         | string | `text/plain` 或 `text/markdown`。                   |
| `client::notification.click.url`      | string | 点击通知后打开的 URL。                              |
| `client::notification.bigImageUrl`    | string | 展示大图。                                          |
| `android::action.onReceive.intentUrl` | string | 通知到达时触发 Android Intent；客户端需要相应权限。 |

`extras` 只在 `Content-Type: application/json` 的 `POST /message` 请求中接受。Gotify 官方
客户端主要面向 Android；iOS 通常依赖第三方客户端或额外桥接。

### pushc 配置示例

```toml
[adapters.gotify]
type = "webhook"
url = "https://push.example.com/message"

[adapters.gotify.request]
method = "POST"
content_type = "application/json"
headers = { X-Gotify-Key = "${GOTIFY_APP_TOKEN}" }

[adapters.gotify.request.body]
message = "{{message}}"
title = "{{title:-pushc}}"
priority = 5

[adapters.gotify.request.body.extras."client::display"]
contentType = "text/plain"

[adapters.gotify.request.body.extras."client::notification".click]
url = "https://example.com/status"
```

官方资料：[Gotify push messages](https://gotify.net/docs/pushmsg)、
[Gotify message extras](https://gotify.net/docs/msgextras)。

## Pushover

### 请求方式

Pushover 只接受 HTTPS `POST`。API 支持 JSON 和
`application/x-www-form-urlencoded`；通用 adapter 推荐优先使用 JSON：

```http
POST https://api.pushover.net/1/messages.json
Content-Type: application/json

{
  "token": "<application-token>",
  "user": "<user-or-group-key>",
  "message": "Build completed"
}
```

图片附件需要 `multipart/form-data`，或者在 JSON 中使用 Base64 附件字段。

### 固定字段

| 字段      | 类型   | 说明                               |
| --------- | ------ | ---------------------------------- |
| `token`   | string | 发送应用的 API Token。             |
| `user`    | string | 接收用户或 Pushover group 的 key。 |
| `message` | string | 通知正文，通常映射 `{{message}}`。 |

### 扩展字段

| 字段                | 类型   | 说明                                                 |
| ------------------- | ------ | ---------------------------------------------------- |
| `device`            | string | 只发给指定设备；省略时发送到用户全部设备。           |
| `title`             | string | 通知标题。                                           |
| `html`              | number | 设为 `1` 时启用有限 HTML；不能与 `monospace` 同用。  |
| `monospace`         | number | 设为 `1` 时使用等宽文本；不能与 `html` 同用。        |
| `priority`          | number | `-2`、`-1`、`0`、`1` 或 `2`。                        |
| `sound`             | string | 覆盖用户默认声音。                                   |
| `timestamp`         | number | 覆盖消息展示时间的 Unix 时间戳。                     |
| `ttl`               | number | 通知存活秒数；紧急优先级会忽略它。                   |
| `url`               | string | 附加跳转 URL。                                       |
| `url_title`         | string | 附加 URL 的展示标题。                                |
| `retry`             | number | 紧急通知重试间隔，最小 30 秒。                       |
| `expire`            | number | 紧急通知停止重试的秒数，最大 10,800 秒。             |
| `callback`          | string | 用户确认紧急通知后接收回调的 URL。                   |
| `tags`              | string | 紧急通知 receipt 标签，逗号分隔。                    |
| `attachment_base64` | string | Base64 图片内容。                                    |
| `attachment_type`   | string | Base64 图片的 MIME type。                            |
| `encrypted`         | number | 设为 `1` 时表示相关字段已按 Pushover E2EE 规范加密。 |

`priority = 2` 是紧急通知，必须同时提供 `retry` 和 `expire`。成功响应会额外返回
`receipt`，可用于查询、确认或取消重复提醒。普通成功响应为 HTTP 200 且 JSON
`status = 1`。

multipart 请求还支持二进制 `attachment`；使用 JSON 时可以改用
`attachment_base64` 与 `attachment_type`。

### pushc 配置示例

```toml
[adapters.pushover]
type = "webhook"
url = "https://api.pushover.net/1/messages.json"

[adapters.pushover.request]
method = "POST"
content_type = "application/json"

[adapters.pushover.request.body]
token = "${PUSHOVER_APP_TOKEN}"
user = "${PUSHOVER_USER_KEY}"
message = "{{message}}"
title = "{{title:-pushc}}"
priority = 0
```

紧急通知可以配置为另一个 adapter 实例，避免普通消息意外继承紧急语义：

```toml
[adapters.pushover-emergency]
type = "webhook"
url = "https://api.pushover.net/1/messages.json"

[adapters.pushover-emergency.request]
method = "POST"
content_type = "application/json"

[adapters.pushover-emergency.request.body]
token = "${PUSHOVER_APP_TOKEN}"
user = "${PUSHOVER_USER_KEY}"
message = "{{message}}"
title = "{{title:-pushc emergency}}"
priority = 2
retry = 60
expire = 1800
```

官方资料：[Pushover Message API](https://pushover.net/api)、
[Pushover Receipts and Callbacks API](https://pushover.net/api/receipts)。
