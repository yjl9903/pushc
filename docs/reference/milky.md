# Milky 协议参考

Milky 是 QQ 协议端与应用端之间的接口标准，覆盖 QQ 私聊和群聊业务。
本文依据官方资料整理通信方式、数据结构、API 和兼容性规则，供协议接入时查阅。
各协议端的实现进度和扩展能力可查阅其对应文档。

## 版本与原始来源

最后核对：**2026-11-23**。基线为当时最新稳定版 **Milky 1.3.0**，发布于 2026-08-07。
协议兼容版本为 `1.3`，协议定义包版本为 `1.3.0`。

原始来源包括官方发布、固定提交下的规范和协议定义，以及补充语义说明的官方 Q&A。

| 原始资料 | 用途与版本 |
| --- | --- |
| [官方 v1.3.0 release][release] | 稳定版发布说明、相对 1.2.2 的变化 |
| [官方源码固定提交][source] | `59cda53a59cb31a4e9f6191d8c6d4027c8813429`，对应 `v1.3.0` |
| [通信规范原文][communication] | HTTP API、鉴权、响应 envelope、事件传输 |
| [兼容性规范原文][compatibility] | 字段演进和未知联合类型处理 |
| [协议 IR 定义目录][ir] | API、公共结构体、必填/可选/默认字段和 `since` |
| [官方发布的 protocol.json][protocol-json] | `@saltify/milky-protocol@1.3.0` 的机器可读 IR |
| [官方 OpenAPI][openapi] | 本次读取为 OpenAPI 3.1.0，`info.version` 为 `1.3.0`；URL 随官网更新 |
| [官方 Q&A][faq] | 持续维护的消息定位、空值、媒体格式和文件事件等补充说明 |
| [官方在线文档][website] | 便于浏览，内容可能随新版变化 |

本次读取的 `protocol.json` 原始字节 SHA-256：

```text
2df17982077b07c20220f7cdac18d80f424ce1efd35fd5f75d71f607582c6836
```

复核字段时，优先查看固定版本 IR，并结合字段描述中的语义约束。
使用在线 OpenAPI 时，先确认 `info.version` 与所需版本一致。

### 1.3 相对 1.2.2 的变化

依据 [release][release] 与 IR 的 `since: '1.3'`：

- 新增 `persist_group_file`，将群文件转存为永久文件。
- `get_private_file_download_url` 新增 `is_self_send`，默认 `false`。
- `OutgoingForwardedMessage` 新增可选 `time`。
- 新增 `group_disband` 事件。
- 新增接收消息段 `markdown`，内容字段为 `data.content`。
- 为发送 `face.is_large` 补齐 `since: '1.1'` 标记。

配套工具调整：类型生成改由官方网站和 `milkygen` 提供，移除 `@saltify/milky-types` 包。

## 通信、鉴权与错误

来源：[通信规范][communication]。

### API 请求

协议端提供 HTTP 服务，应用端调用 `POST /api/<api>`，请求与响应使用 UTF-8 JSON。
配置 `access_token` 后，通过 `Authorization: Bearer <access_token>` 鉴权。
无输入参数的 API 使用 `{}` 作为请求体。

以下请求中的 token 和号码均为示例值：

```http
POST /api/send_private_message
Content-Type: application/json
Authorization: Bearer <access-token>

{
  "user_id": 123456789,
  "message": [
    { "type": "text", "data": { "text": "Hello, world!" } }
  ]
}
```

消息发送通过 HTTP API 完成；事件订阅使用 SSE、WebSocket 或 WebHook。

### 响应 envelope

成功：

```json
{
  "status": "ok",
  "retcode": 0,
  "data": {
    "message_seq": 42,
    "time": 1700000000
  }
}
```

失败：

```json
{
  "status": "failed",
  "retcode": -403,
  "message": "未处于登录状态"
}
```

无输出参数的 API 使用 `data: {}` 表示成功结果。

| 层级 | 状态或错误码 | 含义 |
| --- | --- | --- |
| HTTP | `401` | 未提供鉴权凭据或凭据不匹配 |
| HTTP | `404` | API 路径不存在 |
| HTTP | `415` | 请求 Content-Type 不支持 |
| HTTP | `200` | 其余业务成功或失败；必须继续检查 envelope |
| 业务 | `retcode: 0` | 成功 |
| 业务 | `retcode: -400` | 参数解析失败 |
| 业务 | `retcode: -403` | 协议端未登录 |
| 业务 | `get_message` 的 `retcode: -404` | Q&A 规定：消息已撤回或没有合法消息段 |

业务错误码优先按具体 API 和官方补充说明解释，其余由协议端定义。
例如，`get_message` 的业务 `-404` 表示消息不可用，HTTP `404` 表示 API 路径不存在。
成功判定需要同时考虑 HTTP 状态、`status`、`retcode` 和 API 对应的 `data` 结构。

### 网络安全

官方建议部署在内网；公网部署应限制访问范围、配置防火墙和强随机 token。
API 调用使用 Bearer header 鉴权；事件连接另提供 query token 方式，详见事件传输一节。

## 类型、版本与兼容性

来源：[公共结构体 IR][common]、[系统 API IR][system]、[兼容性规范][compatibility]、
[OpenAPI][openapi] 与 [Q&A][faq]。

- QQ 号、群号、消息序列号等在 JSON 中为整数，IR 用 `int64` 表示这些值。
  本次官方生成 schema 对 UIN 的范围为 `10001..4294967295`，普通整数使用非负
  JavaScript 安全整数范围；具体字段仍需结合描述和语义验证。
- 消息和事件时间使用秒级 Unix 时间戳。
- `face_id`、`file_id`、`resource_id`、`forward_id` 使用 string。
- 请求字段区分必填、可选、有默认值：必填字段须提供，可选字段可省略，
  有默认值的字段省略时采用默认值。Q&A 说明 optional 字段可用 `null` 或省略表示无值；
  其他字段按定义使用 `0` 或空字符串等零值表达相应语义。
- `get_impl_info` 返回 `impl_name`、`impl_version`、`qq_protocol_version`、
  `qq_protocol_type` 和 `milky_version`；本基线的 `milky_version` 为 `"1.3"`。

兼容方向是**协议端向后兼容、应用端向前兼容**：旧应用与新协议端继续通信，
新应用接入旧协议端时需核对所用能力的引入版本。

| 情况 | 官方兼容规则 |
| --- | --- |
| 请求结构体演进 | 允许增加可选/有默认值字段、删除字段或给已有字段增加默认值；其余现有字段定义保持稳定 |
| 响应结构体演进 | 保留现有字段及其定义，通过新增字段扩展 |
| 联合类型演进 | 保留现有子类型，通过新增子类型扩展 |
| 未知非消息事件 | 忽略或警告，继续处理后续事件 |
| 未知接收消息段 | 转为说明当前版本尚未支持该类型的 `text`，继续解析消息 |
| 数组中的其他未知联合类型 | 跳过该元素 |
| 单值中的其他未知联合类型 | 可以报错 |

响应解析应验证已知必需字段，同时容纳新增字段。

## 消息 API

来源：[消息 API IR][message]、[公共结构体 IR][common] 与 [Q&A][faq]。
下表的输出均指成功 envelope 内的 `data`。

| API | 请求字段 | 输出字段 |
| --- | --- | --- |
| `send_private_message` | `user_id`、`message: OutgoingSegment[]` | `message_seq`、`time` |
| `send_group_message` | `group_id`、`message: OutgoingSegment[]` | `message_seq`、`time` |
| `recall_private_message` | `user_id`、`message_seq` | `{}` |
| `recall_group_message` | `group_id`、`message_seq` | `{}` |
| `get_message` | `message_scene`、`peer_id`、`message_seq` | `message: IncomingMessage` |
| `get_history_messages` | `message_scene`、`peer_id`、可选 `start_message_seq`、`limit` 默认 20 | `messages`、可选 `next_message_seq` |
| `get_resource_temp_url` | `resource_id` | `url` |
| `get_forwarded_messages` | `forward_id` | `messages: IncomingForwardedMessage[]` |
| `mark_message_as_read` | `message_scene`、`peer_id`、`message_seq` | `{}` |

### 会话与消息标识

`message_scene` 为 `friend`、`group` 或 `temp`。消息由以下组合定位：

```text
message_scene + peer_id + message_seq
```

`message_seq` 表示消息在当前会话内的顺序。好友会话的 `peer_id` 是好友 QQ 号，
群会话为群号。发送 API 支持好友私聊和群聊；接收、查询和标记已读还支持 `temp` 临时会话。

发送 API 的回执包含序列号与发送时间。`mark_message_as_read` 将当前账号在指定会话中
的指定消息及更早消息标为已读。

### 历史与撤回

- 历史查询从指定序列号开始由新到旧查找；省略起点则从最新消息开始。
- `limit` 默认 20，最多 30；结果按 `message_seq` 升序返回。
- 历史结果跳过已撤回或没有合法消息段的消息，结果可能为空；消息数量以实际返回数组为准。
- 对上述消息调用 `get_message`，按 Q&A 返回业务 `retcode: -404`。
- `message_receive` 推送的消息至少包含一个合法消息段。

## 消息段与媒体

来源：[公共结构体 IR][common] 与 [Q&A][faq]。

### 发送消息段

`OutgoingSegment` 共 10 种，统一外形为 `{ "type": "...", "data": { ... } }`。
下表列出 `data` 内字段，未标记可选或默认值的字段必填。

| `type` | `data` 字段 |
| --- | --- |
| `text` | `text: string` |
| `mention` | `user_id: int64` |
| `mention_all` | `{}` |
| `face` | `face_id: string`；`is_large: bool` 默认 `false` |
| `reply` | `message_seq: int64` |
| `image` | `uri: string`；`sub_type` 默认 `"normal"`，也可为 `"sticker"`；可选 `summary` |
| `record` | `uri: string` |
| `video` | `uri: string`；可选 `thumb_uri` |
| `forward` | `messages: OutgoingForwardedMessage[]`；可选 `title`、`preview`、`summary`、`prompt` |
| `light_app` | `json_payload: string`，内容为小程序 JSON 数据 |

`OutgoingForwardedMessage` 包含 `user_id`、`sender_name`、`segments`，以及 1.3 新增的
可选 `time`。`forward.preview` 若提供，必须有 1 至 4 条；`prompt` 只对移动端 QQ 有效。

普通文件通过文件上传 API 发送。`file`、`market_face`、`xml` 和 `markdown`
属于接收专用消息段。

### 资源 URI 与格式

图片、语音、视频的 `uri`，以及上传文件的 `file_uri`，支持：

| URI | 含义 |
| --- | --- |
| `file://` | 协议端可访问的文件路径 |
| `http://` / `https://` | 由协议端访问的远程资源 |
| `base64://` | URI 中携带 Base64 编码内容 |

头像、群公告图片等相应字段也接受资源 URI，具体字段以各 API 定义为准。
应用端与协议端分机部署时，`file://` 路径以协议端文件系统为准。

Q&A 对协议端规定的最低媒体支持：

- 图片：JPG、PNG、GIF、BMP、WEBP。
- 语音：支持 WAV、MP3 到 QQ SILK 格式的转码。
- 视频：支持 MP4；未提供 `thumb_uri` 时由协议端截帧作为封面。

附件字节上限、HTTP 超时和重试策略需结合所用协议端与客户端的配置确认。

### 接收消息段

`IncomingSegment` 共 14 种：

```text
text, mention, mention_all, face, reply, image, record, video,
file, forward, market_face, light_app, xml, markdown
```

接收结构侧重消息详情和资源引用；回发时需按 `OutgoingSegment` 构造发送内容。

- 媒体段带 `resource_id`、`temp_url` 和尺寸或时长等元数据；
  可用 `get_resource_temp_url` 重新取得临时链接。
- 接收 `reply` 包含 `message_seq`、`sender_id`、`time`、`segments`，
  以及只在合并转发中可取得的可选 `sender_name`。
- 接收 `file` 包含 `file_id`、`file_name`、`file_size` 和可选 `file_hash`；
  `file_hash` 只在私聊文件中存在。
- 接收 `forward` 使用 `forward_id`，通过对应 API 获取具体内容。
- 接收 `markdown` 使用 `data.content`。
- Q&A 说明 QQ 对合并转发中的原发送者 QQ 号和来源群号采用占位值保护；
  展示时可使用接收转发结构中的 `sender_name` 和 `avatar_url`。

## 文件 API

来源：[文件 API IR][file]。私聊和群文件通过各自的上传 API 发送，上传结果返回 `file_id`。

| API | 请求字段 | 输出字段 |
| --- | --- | --- |
| `upload_private_file` | `user_id`、`file_uri`、`file_name` | `file_id` |
| `upload_group_file` | `group_id`、`file_uri`、`file_name`；`parent_folder_id` 默认 `"/"` | `file_id` |
| `get_private_file_download_url` | `user_id`、`file_id`、`file_hash`；`is_self_send` 默认 `false`（1.3） | `download_url` |
| `get_group_file_download_url` | `group_id`、`file_id` | `download_url` |
| `get_group_files` | `group_id`；`parent_folder_id` 默认 `"/"` | `files`、`folders` |
| `move_group_file` | `group_id`、`file_id`；`parent_folder_id`、`target_folder_id` 均默认 `"/"` | `{}` |
| `rename_group_file` | `group_id`、`file_id`、`new_file_name`；`parent_folder_id` 默认 `"/"` | `{}` |
| `delete_group_file` | `group_id`、`file_id` | `{}` |
| `persist_group_file`（1.3） | `group_id`、`file_id` | `{}` |
| `create_group_folder` | `group_id`、`folder_name` | `folder_id` |
| `rename_group_folder` | `group_id`、`folder_id`、`new_folder_name` | `{}` |
| `delete_group_folder` | `group_id`、`folder_id` | `{}` |

私聊下载的 `file_hash` 使用接收文件信息中的 TriSHA1 哈希值。

Q&A 要求协议端收到文件消息后，同时推送包含 `file` 段的 `message_receive` 和对应
`friend_file_upload` / `group_file_upload` 事件。两种通知描述同一次上传，
应用端可按需选择事件入口。

## 事件传输与事件范围

来源：[通信规范][communication] 与 [Event IR][common]。

| 方式 | 入口 | 格式与鉴权 |
| --- | --- | --- |
| SSE | `GET /event` | `Content-Type: text/event-stream`；事件名 `milky_event`，data 为 Event JSON |
| WebSocket | `/event`，HTTP Upgrade | 每条消息为 Event JSON |
| WebHook | 协议端 POST 到配置地址，可配置多个 | body 为 Event JSON；配置 token 后由应用端校验 Bearer header |

SSE 和 WebSocket 优先使用 Bearer header；受限于客户端 header 设置能力时，可传 query
`access_token`。服务端通过 `Upgrade: websocket` 区分 WebSocket 与 SSE。

Event 的公共字段为 `time`、`self_id`、`event_type`、`data`。其中 `time` 为秒级 Unix
时间戳，`self_id` 为机器人 QQ 号，`data` 随 `event_type` 变化。1.3 定义 21 种事件：

| 类别 | `event_type` |
| --- | --- |
| 账号与消息 | `bot_offline`、`message_receive`、`message_recall`、`peer_pin_change` |
| 请求与邀请 | `friend_request`、`group_join_request`、`group_invited_join_request`、`group_invitation` |
| 好友互动与文件 | `friend_nudge`、`friend_file_upload` |
| 群管理与成员 | `group_admin_change`、`group_member_increase`、`group_member_decrease`、`group_disband`（1.3）、`group_name_change`、`group_mute`、`group_whole_mute` |
| 群内容与互动 | `group_essence_message_change`、`group_message_reaction`、`group_nudge`、`group_file_upload` |

上表为标准事件全集。心跳、事件确认、断线重放和重试等扩展机制，
需查阅所用协议端的具体约定。

## 其他 API 索引

1.3 共定义 **65 个 API**：系统 17、消息 9、好友 6、群聊 21、文件 12；
公共结构体共 16 个。消息和文件 API 已在上文完整列出，其他 API 索引如下。

### 系统 API（17）

来源：[系统 API IR][system]。

- 账号和实现：`get_login_info`、`get_impl_info`、`get_user_profile`。
- 好友/群资料：`get_friend_list`、`get_friend_info`、`get_group_list`、`get_group_info`、
  `get_group_member_list`、`get_group_member_info`。
- 置顶：`get_peer_pins`、`set_peer_pin`。
- 账号设置：`set_avatar`、`set_nickname`、`set_bio`。
- 资源与凭据：`get_custom_face_url_list`、`get_cookies`、`get_csrf_token`。

好友、群及成员查询中的 `no_cache` 默认 `false`。`get_login_info` 返回登录账号
`uin` 和 `nickname`。Cookies 和 CSRF Token 是敏感凭据。

### 好友 API（6）

来源：[好友 API IR][friend]。

`send_friend_nudge`、`send_profile_like`、`delete_friend`、`get_friend_requests`、
`accept_friend_request`、`reject_friend_request`。

### 群聊 API（21）

来源：[群聊 API IR][group]。

- 资料和权限：`set_group_name`、`set_group_avatar`、`set_group_member_card`、
  `set_group_member_special_title`、`set_group_member_admin`、`set_group_member_mute`、
  `set_group_whole_mute`、`kick_group_member`、`quit_group`。
- 公告：`get_group_announcements`、`send_group_announcement`、`delete_group_announcement`。
- 精华和互动：`get_group_essence_messages`、`set_group_essence_message`、
  `send_group_message_reaction`、`send_group_nudge`。
- 通知和请求：`get_group_notifications`、`accept_group_request`、`reject_group_request`、
  `accept_group_invitation`、`reject_group_invitation`。

## 后续更新时的核对方式

1. 核对官方 release，记录所选版本、发布状态和对应提交。
2. 从固定版本 IR 核对 API 名、字段、默认值、联合类型和 `since`，再对照通信及兼容性规范。
3. 检查在线 OpenAPI 的 `info.version`；若保存快照，记录下载地址、版本、原始字节哈希和上游许可。
4. 为 Q&A 中的补充语义注明来源，区分标准定义和实现约定。
5. 更新本文日期、版本、数量和能力范围。

[release]: https://github.com/SaltifyDev/milky/releases/tag/v1.3.0
[source]: https://github.com/SaltifyDev/milky/tree/59cda53a59cb31a4e9f6191d8c6d4027c8813429
[communication]: https://github.com/SaltifyDev/milky/blob/59cda53a59cb31a4e9f6191d8c6d4027c8813429/docs/content/guide/communication.md
[compatibility]: https://github.com/SaltifyDev/milky/blob/59cda53a59cb31a4e9f6191d8c6d4027c8813429/docs/content/guide/compatibility.md
[ir]: https://github.com/SaltifyDev/milky/tree/59cda53a59cb31a4e9f6191d8c6d4027c8813429/protocol/src/ir
[protocol-json]: https://unpkg.com/@saltify/milky-protocol@1.3.0/dist/protocol.json
[openapi]: https://milky.ntqqrev.org/raw/openapi/openapi.json
[faq]: https://github.com/SaltifyDev/milky/issues/46
[website]: https://milky.ntqqrev.org/
[common]: https://github.com/SaltifyDev/milky/blob/59cda53a59cb31a4e9f6191d8c6d4027c8813429/protocol/src/ir/common.ts
[system]: https://github.com/SaltifyDev/milky/blob/59cda53a59cb31a4e9f6191d8c6d4027c8813429/protocol/src/ir/api/system.ts
[message]: https://github.com/SaltifyDev/milky/blob/59cda53a59cb31a4e9f6191d8c6d4027c8813429/protocol/src/ir/api/message.ts
[file]: https://github.com/SaltifyDev/milky/blob/59cda53a59cb31a4e9f6191d8c6d4027c8813429/protocol/src/ir/api/file.ts
[friend]: https://github.com/SaltifyDev/milky/blob/59cda53a59cb31a4e9f6191d8c6d4027c8813429/protocol/src/ir/api/friend.ts
[group]: https://github.com/SaltifyDev/milky/blob/59cda53a59cb31a4e9f6191d8c6d4027c8813429/protocol/src/ir/api/group.ts
