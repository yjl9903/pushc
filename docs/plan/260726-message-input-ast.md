# Multi-format single-message input and normalized content AST

## Background and goals

`PushPayload` previously coupled one text body to a separate attachment list, so callers could not
express exact text/attachment ordering. The CLI also treated `--file` and stdin only as text, which
made structured, agent-authored sends cumbersome.

This change lets CLI input use JSON, TOML, or literal text and gives library callers string,
string-array, and ordered AST inputs. Every entry point converges on one normalized content AST
before an adapter prepares a request.

## Key decisions

- CLI owns source reading, syntax detection, structured document extraction, target override, and
  file-relative attachment paths.
- Core exclusively validates and normalizes `PushPayload`; CLI does not generate or reorder AST
  nodes.
- Public nodes are limited to `text` and `attachment`. Adapter-specific nodes are reserved for a
  future `<adapter>:<node>` syntax and are rejected in this release.
- Shortcut `attachments` are allowed only with string or string-array content and normalize before
  generated text nodes. Explicit AST content cannot also declare `attachments`.
- `.json` and `.toml` prefer their matching parser, `.txt` is always literal, and extensionless
  files or stdin try JSON, TOML, then text. A parser syntax success commits to that format; schema
  failure never falls back to literal text.
- Each structured document represents one send. It may provide a default target, which CLI
  `--target` overrides.
- Structured message params are preserved, while CLI params override matching keys and retain
  unmatched document params.
- An explicit attachment `mediaType` is authoritative. NapCat only probes remote MIME types when
  the field is omitted.
- A missing or `undefined` raw `param` is the same as not passing params; normalization omits it.

## Technical approach

`PushPayload.content` accepts a string, a string array, or a `PushContent[]`. Core converts strings
to text nodes, prepends shortcut attachments, validates explicit nodes, and validates metadata.
Adapter preparation hooks receive only that normalized type.

The CLI parses a structured document into `{ target?, payload }`. TOML/JSON `media_type` is mapped
to the public `mediaType` property, and common attachment sources in files resolve from the message
file directory. Literal input retains the existing title, param, and attachment CLI options.
Structured input owns attachments. CLI target and title replace their corresponding document
values, while CLI params override matching keys and retain unmatched document params. Param merging
only applies key precedence and leaves final validation to core.

NapCat walks normalized nodes in order and prepares each attachment through its existing private
receipt/transport split. It records the message indices of remote attachments without an explicit
`mediaType`, so dispatch probes only those nodes without changing AST order. Webhook concatenates
text nodes without a separator and rejects attachment nodes.
