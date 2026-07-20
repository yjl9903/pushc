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

Load and validate the configuration, initialize adapters, and list configured destination addresses
in lexical order. An adapter with named targets produces one entry per target. An adapter without
named targets produces its default address, even though no named target is registered.

Text output:

```text
deploy:release
qq:ops-group
```

With no adapters, text output is `No targets configured.`

JSON output:

```json
{
  "ok": true,
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
pushc send --target <adapter[:target]> [...content]
pushc send --target <adapter[:target]> --file <path>
<producer> | pushc send --target <adapter[:target]>
```

`--target` is required. Adapter and target names must start with a letter or digit and contain only
letters, digits, `_`, or `-`. At most one colon is allowed. `qq:ops` selects named target `ops` on
adapter `qq`; `qq` selects the adapter's default target. Omitting a target does not fall back to the
only named target.

Message source precedence and validation:

1. One or more positional content words are joined with a single space.
2. Otherwise, `-f, --file <path>` reads the file as UTF-8.
3. Otherwise, non-TTY stdin is read to completion.
4. With TTY stdin and no other source, or when the resolved message is whitespace-only, the command
   fails.

Positional content and `--file` are mutually exclusive. File and stdin content are not trimmed
before delivery, but every source must contain at least one non-whitespace character.

Text success examples:

```text
Sent to deploy:release (HTTP 204).
Sent to qq:ops-group (message 12345).
```

Receipt details appear only when the adapter exposes a safe HTTP status or message ID. JSON success
preserves the result fields:

```json
{
  "ok": true,
  "adapter": "deploy",
  "target": "release",
  "receipt": { "status": 204, "statusText": "No Content" }
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

Errors normally use this text form on stderr:

```text
pushc: <message>
```

Contextual errors with `--json` use:

```json
{ "ok": false, "error": { "code": "CONFIG_NOT_FOUND", "message": "..." } }
```

Exit statuses:

- `0`: command completed successfully.
- `2`: CLI usage, message validation, config loading/validation, adapter lookup, or target lookup
  failure.
- `1`: send failure or unexpected internal/runtime failure.

Common codes include `CLI_USAGE`, `CONFIG_NOT_FOUND`, `CONFIG_READ_FAILED`, `CONFIG_INVALID`,
`ENV_MISSING`, `INVALID_CONFIG`, `UNKNOWN_ADAPTER`, `INVALID_TARGET`, `ADAPTER_NOT_FOUND`,
`TARGET_NOT_FOUND`, `MESSAGE_SOURCE_CONFLICT`, `MESSAGE_FILE_FAILED`, `MESSAGE_EMPTY`, and
`SEND_FAILED`. Adapter-specific delivery failures can be surfaced through `SEND_FAILED` messages.

## Operational behavior

Both commands destroy initialized clients and close persistent connections before exiting. `targets`
may therefore contact services during adapter initialization; notably, NapCat connects to its
WebSocket API. Webhook initialization does not issue the configured HTTP request. Only `send`
delivers a notification.

Do not automatically retry sends. A transport failure can be ambiguous, and retrying may duplicate a
notification.
