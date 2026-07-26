# Pushc CLI reference

## Contents

- [Invocation](#invocation)
- [Global options](#global-options)
- [targets](#targets)
- [send](#send)
- [Adapter-specific behavior](#adapter-specific-behavior)
- [Configuration loading](#configuration-loading)
- [Output and exit status](#output-and-exit-status)

## Invocation

Pushc requires Node.js 24 or newer.

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
Some early argument errors may still be written as plain text.

## `targets`

```bash
pushc targets [--config <path>] [--json]
```

Load and validate the configuration, then list configured destinations in lexical order. An adapter
with named targets produces one entry per target. An adapter without named targets produces its
default destination, even though no named target is registered.

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
pushc send --target <adapter[:target]> [options] [...content]
pushc send [--target <adapter[:target]>] [options] --file <path>
<producer> | pushc send [--target <adapter[:target]>] [options]
```

### Target

Every message needs a target. Pass `--target`, or declare `target` in a structured message file.
CLI `--target` overrides the value in the message file. Adapter and target names must start with a
letter or digit and contain only letters, digits, `_`, or `-`. At most one colon is allowed.
`alerts:release` selects the named `release` target on the `alerts` adapter. `alerts` selects that
adapter's default target; it does not select the adapter's only named target.

### Message sources

Pushc obtains message content from these sources:

1. Positional content after `send` is joined with one space and treated as literal text.
2. `-f, --file <path>` reads a UTF-8 message file.
3. When neither is present, non-TTY stdin is read to completion.

Positional content and `--file` are mutually exclusive. When `--file` is present, pushc does not read
stdin. With no content source, at least one CLI attachment is required.

### Literal text

Pass short text directly:

```bash
pushc send --target alerts:release "Production deployment succeeded."
```

Use a `.txt` file when whitespace and line breaks must be preserved:

```bash
pushc send --target alerts:release --file ./message.txt
```

A `.txt` file is always literal text, even if its contents look like JSON or TOML. Plain-text file
and stdin content is not trimmed or otherwise transformed before sending. A whitespace-only
message requires at least one attachment.

Literal text can be combined with `--title`, `--param`, and `--attachment`:

```bash
pushc send --target alerts:release \
  --title "Build completed" \
  --param environment=production \
  --attachment ./report.pdf \
  --file ./message.txt
```

CLI attachment paths resolve from the current working directory.

### Structured messages

Use a structured message file to define a reusable message template or to control the exact order
and metadata of text and attachments. Each file describes one message.

JSON is the primary structured format:

```json
{
  "target": "alerts:release",
  "title": "Build completed",
  "param": {
    "environment": "production",
    "group": "deployments"
  },
  "content": [
    {
      "type": "text",
      "text": "Production deployment succeeded.\n"
    },
    {
      "type": "attachment",
      "source": "./report.pdf",
      "name": "deployment-report.pdf",
      "media_type": "application/pdf"
    },
    {
      "type": "text",
      "text": "Review the attached report."
    }
  ]
}
```

Send it with:

```bash
pushc send --file ./message.json
```

Structured JSON can also be read from stdin.

Write a structured message file with these fields:

| Field     | Value                           | Description                                  |
| --------- | ------------------------------- | -------------------------------------------- |
| `content` | ordered content array           | Required message content.                    |
| `target`  | string                          | Default target; CLI `--target` overrides it. |
| `title`   | string                          | Optional title; CLI `--title` overrides it.  |
| `param`   | object containing string values | Optional adapter parameters.                 |

`param` keys follow the same rules as CLI `--param` keys. The `content` array accepts only `text`
and `attachment` nodes.

A text node contains:

- `type`: must be `text`.
- `text`: the text string to send.

An attachment node contains:

- `type`: must be `attachment`.
- `source`: a non-empty source accepted by the selected adapter.
- `name`: an optional non-empty attachment name.
- `media_type`: an optional MIME type such as `application/pdf`.

Nodes appear in the declared order. Unknown node types and unknown node fields are rejected.

Relative attachment sources in a message file resolve from that file's directory. For piped JSON or
TOML, they resolve from the current working directory. Absolute paths and sources with a URI scheme,
such as `https://`, are passed unchanged to the selected adapter.

CLI options interact with a structured message as follows:

| CLI option     | Behavior                                                     |
| -------------- | ------------------------------------------------------------ |
| `--target`     | Overrides `target` in the message.                           |
| `--param`      | Merges into `param`; CLI values override matching keys.      |
| `--title`      | Overrides `title` in the message.                            |
| `--attachment` | Rejected; use attachment nodes if the adapter supports them. |
| `--dry-run`    | Prepares the message normally without sending it.            |
| `--json`       | Changes CLI output only.                                     |
| `--config`     | Selects CLI configuration only.                              |

TOML structured messages are also supported and use the same fields and content rules.

### Format detection

Message files and stdin are detected in this order; suffix matching is case-insensitive:

| Input                   | Detection order    |
| ----------------------- | ------------------ |
| `.json`                 | JSON → TOML → text |
| `.toml`                 | TOML → JSON → text |
| `.txt`                  | text only          |
| Other or no file suffix | JSON → TOML → text |
| stdin                   | JSON → TOML → text |

Pushc tries the next format only when JSON or TOML syntax cannot be parsed. Once either parser
accepts the syntax, the input is treated as structured. If it is not a valid message object, pushc
reports an error instead of reinterpreting it as text.

Positional content is always literal text and is never inspected as JSON or TOML.

### Send options

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

`--dry-run` validates and prepares the same message and destination as a real send without sending
it. Preparation details are adapter-specific. A successful dry-run means the send is ready, not
completed.

### Send output

Text success examples:

```text
Send succeeded: alerts:release
Summary: Notification accepted.
```

Text output shows the receipt summary. JSON preserves the complete redacted receipt; fields other
than `summary` depend on the adapter:

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
response from the destination:

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

Configuration fields, attachment support, sending, output, and errors are defined by the selected
adapter:

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
- `1`: send failure or unexpected failure.
