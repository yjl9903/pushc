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

## Message behavior

NapCat sends one QQ message:

- A `user_id` target sends a private message.
- A `group_id` target sends a group message.
- Text and attachment nodes retain their exact input order.
- Each text node remains separate, including empty and whitespace-only nodes.
- `title` and `param` can render message-content templates but are not sent as separate QQ fields.

## Attachment sources and preparation

NapCat accepts local file paths and credential-free HTTP(S) URLs. A relative path passed with CLI
`--attachment` resolves from the current working directory. A relative attachment source in a
message file resolves from that file's directory; in piped JSON or TOML, it resolves from the
current working directory. A local source must be a readable regular file. A source containing
`scheme://` is treated as a URL; only HTTP and HTTPS are accepted. Other strings, including relative
paths containing `:`, remain local paths.

The total size of local attachments must not exceed `max_attachment_bytes`. Remote URLs are not
downloaded by pushc and do not count toward that limit. Do not put secrets in attachment URLs.
Receipts omit local paths, encoded file contents, and remote URL paths, queries, or credentials.

An explicit attachment `media_type` in a structured message is authoritative. Otherwise, MIME type
comes from the local filename or URL path; a real send may use a valid remote Content-Type when
available. If a remote Content-Type cannot be determined, pushc uses the filename or URL path type
without failing the send. Images, audio, and video map to NapCat image, record, and video messages;
other or unknown types map to files. NapCat consumes the text, source, name, and media type after
core renders their title/param templates; it does not apply another transformation. Every rendered
text node preserves its whitespace.

## Dry run and sending

`--dry-run` validates remote URL syntax and fully prepares local files without contacting NapCat or
an attachment host. A successful dry run confirms local preparation only.

A real send requires the configured NapCat WebSocket service to be reachable. The configured timeout
covers remote attachment inspection, connection, and sending.

## Receipts and failures

A successful receipt records the sanitized prepared message and NapCat's message ID. Its summary
identifies whether the destination was a user or group and includes the message ID when available.

Invalid connection settings, targets, attachments, or message content fail before sending.
Connection, timeout, cancellation, and platform failures return a failed send with every available
receipt field. Configuration and target failures use `INVALID_CONFIG`; sending failures use
`SEND_FAILED`.

Do not automatically retry. A connection failure can occur after QQ accepts the message, so a retry
may send it twice.
