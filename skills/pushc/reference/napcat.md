# NapCat adapter

Read this reference before configuring a `type = "napcat"` adapter or relying on its target,
attachment, dry-run, connection, receipt, or error behavior. NapCat must already be running and
expose a reachable forward WebSocket API.

## Configuration and targets

```toml
[adapters.qq]
type = "napcat"
base_url = "ws://127.0.0.1:3001"
access_token = "${NAPCAT_TOKEN}"
timeout_ms = 10000
max_attachment_bytes = 33554432

[adapters.qq.targets.ops-group]
group_id = "123456789"

[adapters.qq.targets.owner]
user_id = "987654321"
```

Adapter fields:

- `base_url` (required): `ws://` or `wss://` URL.
- `access_token`: optional NapCat access token. A trimmed empty string is treated as absent.
- `timeout_ms`: positive safe integer, default `10000`.
- `max_attachment_bytes`: positive safe integer limiting the total original bytes of local
  attachments in one message, default `33554432` (32 MiB).
- `user_id` or `group_id`: optional adapter-level default destination.

Each resolved destination must contain exactly one of `user_id` or `group_id`. IDs contain decimal
digits and must be positive JavaScript-safe integers. Named targets may override only these two
destination fields; they cannot override connection options.

For a default destination, put exactly one ID directly on the adapter and send to `qq`. Otherwise,
define named targets and send to destinations such as `qq:ops-group`. Defining a single named target
does not make it the default.

## Payload mapping

NapCat sends one QQ `send_msg` request:

- A `user_id` target becomes a private message.
- A `group_id` target becomes a group message.
- Attachments become message segments in input order.
- A non-whitespace message becomes one text segment after all attachment segments.
- An attachment-only payload does not create an empty text segment.
- `title` and `param` are ignored.

## Attachment sources and preparation

NapCat accepts local file paths and credential-free HTTP(S) URLs. Relative local paths resolve from
the current working directory captured for the send. A local source must be a readable regular file.
A source containing `scheme://` is treated as a URL; only HTTP and HTTPS are accepted. Other strings,
including relative paths containing `:`, remain local paths.

Local attachments are read once, checked against the aggregate `max_attachment_bytes` limit,
SHA-256 hashed, and converted internally to `base64://` transport data. The public receipt records
only the safe filename, MIME type, original size, hash, and `encoding: "base64"`; it does not include
the local path or encoded content.

Remote URLs are not downloaded by pushc and do not count toward `max_attachment_bytes`. The complete
URL is passed internally to NapCat, while the public receipt records only a sanitized filename, MIME
type, host, and `encoding: "url"`. It omits the URL path, query, and credentials. Do not put secrets
in attachment URLs.

MIME type initially comes from the local filename or URL path. Images, audio, and video map to
NapCat image, record, and video segments; other or unknown types map to file segments. Before a real
send, pushc issues bounded concurrent HEAD requests for remote URLs and uses a valid response
Content-Type when available. Probe failures fall back to the initial type and do not by themselves
fail the send.

## Dry run and connection lifecycle

`--dry-run` validates remote URLs and fully prepares local files, including reading, size checking,
encoding, and hashing. It does not probe remote MIME types, create a client, connect, upload, call
`send_msg`, or otherwise contact NapCat or an attachment host. A successful dry run confirms local
preparation only.

A real send creates the WebSocket client lazily. Concurrent first sends share the same connection,
and later sends reuse it until the CLI destroys the adapter. The operation timeout covers remote
MIME probing, connection, and `send_msg`. Connection failure clears the cached client so a later
explicit send can try again. The CLI closes acquired resources before exiting.

## Receipts and failures

A successful receipt records the sanitized prepared message and NapCat's message ID. Its summary
identifies whether the destination was a user or group and includes the message ID when available.

Invalid connection, target, source, file, size, or payload preparation fails without sending.
Connection, SDK, timeout, cancellation, and platform failures return a failed send with every
available receipt field. Configuration and target failures use `INVALID_CONFIG`; dispatch failures
surface through `SEND_FAILED`.

Do not automatically retry. A connection or transport failure can be ambiguous after dispatch and a
retry may duplicate the QQ message.
