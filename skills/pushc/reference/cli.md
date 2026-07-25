# Pushc CLI reference

## Contents

- [Invocation](#invocation)
- [Global options](#global-options)
- [targets](#targets)
- [send](#send)
- [Adapter-specific behavior](#adapter-specific-behavior)
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
alerts:release
status
```

With no adapters, text output is `No targets configured.`

JSON output:

```json
{
  "success": true,
  "targets": [{ "adapter": "alerts", "target": "release" }, { "adapter": "status" }]
}
```

Default targets omit the `target` property: `{"adapter":"status"}`. Output never includes adapter
options, target options, URLs, or tokens.

## `send`

```bash
pushc send --target <adapter[:target]> [--title <title>] [--param key=value] [--attachment <source>] [--dry-run] [...content]
pushc send --target <adapter[:target]> [--title <title>] [--param key=value] [--attachment <source>] [--dry-run] --file <path>
<producer> | pushc send --target <adapter[:target]> [--dry-run]
```

`--target` is required. Adapter and target names must start with a letter or digit and contain only
letters, digits, `_`, or `-`. At most one colon is allowed. `alerts:release` selects named target
`release` on adapter `alerts`; `alerts` selects the adapter's default target. Omitting a target does
not fall back to the only named target.

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

`-a, --attachment <source>` may be repeated and preserves source strings, order, and duplicates.
Repeat the complete option for every source:

```bash
--attachment <first-source> --attachment <second-source>
```

The selected adapter decides whether attachments are supported, which source formats are valid, how
they are prepared, and whether an empty message may accompany them. Read its reference before using
this option.

`--dry-run` performs the same configuration, destination, target, payload, and local preparation as
a real send, then returns the prepared send without dispatching it. Preparation details are
adapter-specific. A successful dry-run means the send is ready, not completed.

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
Send succeeded: alerts:release
Summary: Notification accepted.
```

Text details come from the unified receipt summary. JSON preserves the complete redacted receipt;
receipt fields other than `summary` depend on the adapter:

```json
{
  "success": true,
  "adapter": "alerts",
  "target": "release",
  "receipt": {
    "request": {},
    "summary": "Notification accepted."
  }
}
```

Dry-run text output includes the prepared request:

```text
Dry run ready: alerts:release
Request:
{}
```

Dry-run JSON sets `dryRun: true`; its receipt contains the adapter's prepared `request` but no
platform `response`:

```json
{
  "dryRun": true,
  "success": true,
  "adapter": "alerts",
  "target": "release",
  "receipt": {
    "request": {}
  }
}
```

## Adapter-specific behavior

The CLI forwards the target, payload, attachments, and dry-run request through the common adapter
contract. Configuration fields, payload interpretation, attachment support, preparation, transport,
receipts, and platform errors are defined by the selected adapter:

- [Webhook adapter](webhook.md)
- [NapCat adapter](napcat.md)

## Configuration loading

Resolution order is `--config`, `PUSHC_CONFIG`, `<cwd>/.pushc/config.toml`,
`$XDG_CONFIG_HOME/pushc/config.toml`, then `~/.config/pushc/config.toml`. Explicit paths may name a
file or directory; automatically discovered candidates must be regular files.

Pushc loads `.env` beside the selected config with existing process variables taking precedence,
then expands `${NAME}` in all TOML string values. Missing variables fail validation. The root table
accepts only `adapters`.

See [configuration.md](configuration.md) for common loading and security rules and the adapter
references above for schemas and examples.

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
Send failed: alerts:release
Error: Destination rejected the notification.
```

```json
{
  "success": false,
  "adapter": "alerts",
  "target": "release",
  "receipt": { "request": {} },
  "error": { "code": "SEND_FAILED", "message": "Destination rejected the notification." }
}
```

Dry-run failures use the same error codes and preserve a prepared request when one is available:

```text
Dry run failed: alerts:release
Error: Invalid adapter configuration.
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
