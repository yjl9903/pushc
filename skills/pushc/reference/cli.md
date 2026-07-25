# Pushc CLI reference

## Contents

- [Invocation](#invocation)
- [Global options](#global-options)
- [targets](#targets)
- [send](#send)
- [Configuration loading](#configuration-loading)
- [Output and exit status](#output-and-exit-status)
- [Operational behavior](#operational-behavior)

## Invocation

Pushc requires Node.js 24 or newer and is distributed from npm:

```bash
npm install -g pushc
pushc --version
pushc --help
```

Syntax:

```text
pushc <command> [options]
```

Commands are `targets` and `send`. `-h, --help` prints help; `-v, --version` prints the package
version.

## Global options

### `-c, --config <path>`

Select a TOML file or a directory containing `config.toml`. A relative path resolves from the current
working directory. This takes precedence over `PUSHC_CONFIG` and automatic discovery.

### `--json`

Write one compact JSON object followed by a newline. Success goes to stdout. Errors go to stderr.
Argument parser failures that occur before a command context is established may fall back to plain
text rather than JSON.

## `targets`

```bash
pushc targets [--config <path>] [--json]
```

Load and validate the configuration, construct adapters, and list configured destinations in lexical
order. An adapter with named targets produces one entry per target. An adapter without named targets
produces its default destination, even though no named target is registered.

Text output:

```text
deploy:release
qq:ops-group
```

With no adapters, text output is `No targets configured.`

JSON output:

```json
{
  "success": true,
  "targets": [
    { "adapter": "deploy", "target": "release" },
    { "adapter": "qq", "target": "ops-group" }
  ]
}
```

Default targets omit the `target` property: `{"adapter":"deploy"}`. Output never includes adapter
options, target options, URLs, or tokens.

## `send`

```bash
pushc send --target <adapter[:target]> [--title <title>] [--param key=value] [--attachment <source>] [--dry-run] [...content]
pushc send --target <adapter[:target]> [--title <title>] [--param key=value] [--attachment <source>] [--dry-run] --file <path>
<producer> | pushc send --target <adapter[:target]> [--dry-run]
```

`--target` is required. Adapter and target names must start with a letter or digit and contain only
letters, digits, `_`, or `-`. At most one colon is allowed. `qq:ops` selects named target `ops` on
adapter `qq`; `qq` selects the adapter's default target. Omitting a target does not fall back to the
only named target.

`--title` supplies the optional public title field.

`--param key=value` may be repeated and supplies a flat string map. Repeat the complete option for
every entry:

```bash
--param key1=value --param key2=value --param key3=value
```

Each entry is split at its first `=`; an empty value is valid, additional `=` characters belong to
the value, and key/value are not trimmed. Keys match `[A-Za-z0-9][A-Za-z0-9_.-]*` and are
case-sensitive. Missing `=`, invalid/empty keys, and duplicate keys fail with `CLI_USAGE`. Title and
params are not credential channels.

`-a, --attachment <source>` may be repeated and preserves source order and duplicates. NapCat
accepts local paths and HTTP(S) URLs; relative paths resolve from the current working directory.
Repeat the complete option for every source:

```bash
--attachment ./first.png --attachment https://example.com/second.pdf
```

Local files are read, size-limited, Base64-encoded for transport, and represented in receipts only
by filename, MIME type, size, and SHA-256. Remote URLs are passed to NapCat and represented without
their path, query, or credentials. A real send probes remote MIME types with bounded concurrent HEAD
requests before connecting. Attachment segments precede the optional text segment. Webhook
destinations reject any non-empty attachment list.

`--dry-run` performs the same configuration, destination, target, payload, and local preparation as
a real send, then returns the prepared send without performing it. With NapCat attachments it reads,
encodes, and hashes local files, but does not probe remote URLs, connect, upload, or contact the
destination. A successful dry-run means the send is ready, not completed.

Message source precedence and validation:

1. One or more positional content words are joined with a single space.
2. Otherwise, `-f, --file <path>` reads the file as UTF-8.
3. Otherwise, non-TTY stdin is read to completion.
4. With one or more attachments, an empty message from any source is valid; otherwise, TTY stdin
   with no other source or a whitespace-only resolved message fails.

Positional content and `--file` are mutually exclusive. File and stdin content are not trimmed
before sending.

Text success examples:

```text
Send succeeded: deploy:release
Summary: Webhook POST to hooks.example.com completed with HTTP 204.
Send succeeded: qq:ops-group
Summary: NapCat sent a message to group 123456 (message ID: 12345).
```

Text details come from the unified receipt summary. JSON preserves the complete redacted receipt:

```json
{
  "success": true,
  "adapter": "deploy",
  "target": "release",
  "receipt": {
    "summary": "Webhook POST to hooks.example.com completed with HTTP 204.",
    "request": {
      "url": "[REDACTED]",
      "method": "POST",
      "headers": {},
      "timeout_ms": 10000
    },
    "response": { "status": 204, "headers": {} }
  }
}
```

Dry-run text output includes the prepared request:

```text
Dry run ready: deploy:release
Request:
{
  "url": "[REDACTED]",
  "method": "POST",
  "headers": {},
  "timeout_ms": 10000
}
```

Dry-run JSON sets `dryRun: true`; its receipt contains `request` but no platform `response`:

```json
{
  "dryRun": true,
  "success": true,
  "adapter": "deploy",
  "target": "release",
  "receipt": {
    "request": {
      "url": "[REDACTED]",
      "method": "POST",
      "headers": {},
      "timeout_ms": 10000
    }
  }
}
```

## Configuration loading

Resolution order is `--config`, `PUSHC_CONFIG`, `<cwd>/.pushc/config.toml`,
`$XDG_CONFIG_HOME/pushc/config.toml`, then `~/.config/pushc/config.toml`. Explicit paths may name a
file or directory; automatically discovered candidates must be regular files.

Pushc loads `.env` beside the selected config with existing process variables taking precedence,
then expands `${NAME}` in all TOML string values. Missing variables fail validation. The root table
accepts only `adapters`. Supported adapter types are `webhook` and `napcat`.

See [configuration.md](configuration.md) for schemas and examples.

## Output and exit status

Errors without a valid send destination use this text form on stderr:

```text
Error: <message>
```

Contextual errors with `--json` use:

```json
{ "success": false, "error": { "code": "CONFIG_NOT_FOUND", "message": "..." } }
```

Send failures retain every available destination and receipt field:

```text
Send failed: deploy:release
Error: Webhook returned HTTP 503.
```

```json
{
  "success": false,
  "adapter": "deploy",
  "target": "release",
  "receipt": {
    "request": {},
    "response": { "status": 503, "headers": {} }
  },
  "error": { "code": "SEND_FAILED", "message": "Webhook returned HTTP 503." }
}
```

Dry-run failures use the same error codes and preserve a prepared request when one is available:

```text
Dry run failed: deploy:release
Error: Invalid webhook configuration.
```

Exit statuses:

- `0`: command completed successfully.
- `2`: CLI usage, message validation, config loading/validation, adapter lookup, or target lookup
  failure.
- `1`: send failure or unexpected internal/runtime failure.

Common codes include `CLI_USAGE`, `CONFIG_NOT_FOUND`, `CONFIG_READ_FAILED`, `CONFIG_INVALID`,
`ENV_MISSING`, `INVALID_CONFIG`, `UNKNOWN_ADAPTER`, `INVALID_TARGET`, `ADAPTER_NOT_FOUND`,
`TARGET_NOT_FOUND`, `MESSAGE_SOURCE_CONFLICT`, `MESSAGE_FILE_FAILED`, `MESSAGE_EMPTY`,
`INVALID_MESSAGE`, and `SEND_FAILED`. Adapter-specific send failures can be surfaced through
`SEND_FAILED` messages.

## Operational behavior

Both commands destroy clients and close resources acquired during sending before exiting. A real
send acquires destination resources lazily. Dry-run prepares the send without contacting the
destination.

Do not automatically retry sends. A transport failure can be ambiguous, and retrying may duplicate a
notification.
