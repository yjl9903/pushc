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
  the per-send base path for file-relative attachment paths. It preserves attachment source
  strings so an adapter classifies the rendered value rather than the unrendered template.
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
- JSON/TOML param tables exist only at the file parsing boundary. CLI converts them to Map;
  `PushPayload`, normalized payload, template contexts, and adapters use `ReadonlyMap` exclusively.
- An explicit attachment `mediaType` is authoritative. NapCat only probes remote MIME types when
  the field is omitted.
- A missing or `undefined` raw `param` is the same as not passing params; normalization omits it.
- All content inputs support the same single-pass templates. Text and attachment string fields can
  read `title` and `param`; `message` remains exclusive to Webhook request templates to avoid
  content self-reference.
- Template scanning is a public runtime-neutral core capability. Content is rendered during core
  normalization, while Webhook request URL/header/body rendering remains in the adapter and reuses
  the core scanner.

## Technical approach

`PushPayload.content` accepts a string, a string array, or a `PushContent[]`. Core converts strings
to text nodes, prepends shortcut attachments, validates metadata, renders `text`, attachment
`source`, `name`, and `mediaType`, then validates the rendered nodes. Adapter preparation hooks
receive only that normalized type.

Core exports `renderTemplate(template, context)`. Scalar variables and namespace values are
declared as Maps, so content normalization exposes `title` and the param Map, while Webhook
additionally exposes the concatenated rendered text as `message`. The scanner preserves the
existing fallback, escaping, unknown-expression, and non-recursive behavior.

The CLI parses a structured document into `{ target?, payload, basePath? }`. TOML/JSON
param tables and `--param` entries become Maps, and `media_type` is mapped to the public
`mediaType` property. Attachment source strings remain unchanged. When a message contains
attachments, `basePath` is the absolute message file directory for structured files and the
current working directory for stdin or CLI attachments. Literal input retains the existing title,
param, and attachment CLI options. Structured input owns attachments. CLI target and title replace
their corresponding document values, while CLI params create a new merged Map with matching keys
overridden. Core validates and copies the final Map before adapter preparation, validates the
non-empty base path, and passes it only through adapter operation options.

NapCat walks normalized nodes in order and prepares each attachment through its existing private
receipt/transport split. It classifies each already-rendered source: HTTP(S) URLs and absolute local
paths ignore the base, while relative local paths resolve from the optional absolute `basePath` or
the send-time working directory when no base is supplied. It records the
message indices of remote attachments without an explicit `mediaType`, so dispatch probes only
those nodes without changing AST order. Webhook concatenates rendered text nodes without a
separator and rejects attachment nodes. Its request URL, header values, and body string values are
still rendered during request construction.
