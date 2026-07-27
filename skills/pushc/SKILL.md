---
name: pushc
description: Use when the user asks to configure pushc or send a notification with pushc.
metadata:
  author: OneKuma
  version: '0.0.0'
---

# Pushc

Use `pushc` to send notifications through targets owned by the user. Perform the preflight before
other operations, configure only when necessary, and never expose credentials in commands or output.

## Preflight

1. Run `command -v pushc` to check whether the executable is available.
2. If it is unavailable, verify Node.js 24 or newer with `node --version`, then ask before installing
   the npm-distributed CLI globally with `npm install -g pushc`. Do not silently change the user's
   global environment.
3. Run `pushc targets --json` (plus `--config <path>` when the user supplied a config) to validate
   the configuration and discover usable destinations. This does not test platform connectivity.
4. If pushc reports that no config exists, stop the preflight and read
   [reference/configuration.md](reference/configuration.md) completely before helping the user
   create one. If a config exists but is invalid, use the same reference to diagnose it. Never send a
   test notification unless the user asks for one.

`config.toml` is non-sensitive and may be read and edited. It must contain only placeholders for
tokens, keys, passwords, credentials, and private endpoint URLs. Never read, print, or modify an
adjacent `.env`; pushc itself may load it at runtime. Prefer environment interpolation for every
credential.

## Commands

### `pushc targets`

Use this command to validate the configuration and list available destinations:

```bash
pushc targets --json
```

The preflight already runs it, so reuse that result unless the configuration changes. Add
`--config <path>` only when the user supplies or selects a non-default config.

### `pushc send`

Prerequisite: know the intended destination from `pushc targets` and have non-empty message content
or at least one attachment. For a real send, also require user intent to perform the external side
effect.

Not every adapter supports or uses every message capability. Before using `title`, `param`, or
attachments, read the selected adapter's reference.

Send a basic message:

```bash
pushc send --target alerts:release "Build completed"
```

Pass `--target <adapter[:target]>` unless a structured message file supplies its default target.
CLI `--target` overrides the `target` declared in that file. A destination without a colon selects
that adapter's default target and does not select its sole named target.

Add `--title` when the configured destination uses a title. Do not use titles to pass secrets:

```bash
pushc send --target alerts:release --title "Build completed" "Production deployment succeeded"
```

Add string extension parameters with `--param key=value` when the configured destination uses them.
These override matching params in a structured message file. Repeat the complete option for every
entry, and do not use params to pass secrets:

```bash
pushc send --target alerts:release \
  --param group=deployments \
  --param level=active \
  "Production deployment succeeded"
```

When the selected destination supports attachments, repeat the complete `--attachment <source>`
option for every source:

```bash
pushc send --target alerts:release \
  --attachment <first-source> \
  --attachment <second-source> \
  "Build completed"
```

Do not place credentials in attachment URLs or invent attachment paths; use only sources the user
supplied or explicitly selected.

Add `--dry-run` when the user asks to preview or validate a send:

```bash
pushc send --target alerts:release --dry-run "Build completed"
```

A successful dry-run means the send was prepared, not performed. Attachment preparation follows the
selected destination's rules.

#### Literal text message

For longer literal content, use a `.txt` file. Treat the entire file as one literal text string and
preserve all whitespace and line breaks:

```text
Production deployment succeeded.
Review the deployment log before closing the release.
```

```bash
pushc send --target alerts:release \
  --title "Build completed" \
  --param environment=production \
  --attachment ./report.pdf \
  --file ./message.txt
```

#### Structured JSON message

Use a structured message file when the user wants to define a reusable, general-purpose message
template or needs lower-level control over message structure, such as exact text/attachment
ordering and attachment metadata. Prefer direct CLI content and options for ordinary one-off sends.

Prefer JSON when creating a structured message file:

```bash
pushc send --file ./message.json
```

Each structured file describes exactly one message. Use JSON ordered content so text and
attachments appear in a precise sequence. Omit `param` when the message does not need it:

```json
{
  "target": "alerts:release",
  "title": "Deployment completed",
  "param": {
    "environment": "production",
    "report_file": "report.pdf",
    "report_name": "deployment-report.pdf"
  },
  "content": [
    {
      "type": "text",
      "text": "{{title}} for {{param.environment}}.\n"
    },
    {
      "type": "attachment",
      "source": "./{{param.report_file}}",
      "name": "{{param.report_name}}",
      "media_type": "application/pdf"
    },
    {
      "type": "text",
      "text": "Review the attached report."
    }
  ]
}
```

Use `{{title}}` and `{{param.key}}` in text and attachment string fields. Use
`{{param.key:-fallback}}` when an empty or missing value needs a default. Substitutions run once;
do not expect values containing another expression to be expanded recursively. `{{message}}` is
reserved for Webhook request configuration and is not a message-content variable.

Write relative attachment paths relative to the directory containing the message file.

Use `--file` without positional message content. Put attachments inside a structured message file,
and do not use `--attachment` with that file. CLI `--title` overrides the file's `title`. CLI
`--param` values merge into the file's `param`, with CLI values taking precedence for matching keys.
TOML message files are also supported; see [CLI Reference](reference/cli.md) for format detection
details.

## References

Read [reference/cli.md](reference/cli.md) when exact command behavior, output schemas, config
resolution, input rules, exit status, or troubleshooting details matter.

Read the reference matching the selected adapter before configuring it or relying on
adapter-specific send behavior:

- [Webhook adapter](reference/webhook.md)
- [NapCat adapter](reference/napcat.md)

## Operating rules

- Ask the user which listed target to use when intent is ambiguous.
- Before sending, show or summarize the message and destination when either was inferred rather than
  explicitly supplied. Sending a notification is an external side effect.
- Use `--json` to distinguish validation errors from send failures. Exit status `0` means success,
  `2` means usage/configuration/lookup failure, and `1` means send or unexpected runtime failure.
- Do not retry a failed send automatically: the remote service may have accepted the message before
  the failure became visible.
