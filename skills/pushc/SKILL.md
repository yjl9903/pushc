---
name: pushc
description: Send messages and notifications with the pushc CLI. Use when the user asks to push or send a notification with pushc.
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
3. Run `pushc --version` and report the detected version. If the command fails, diagnose the Node.js
   and npm installation before proceeding. Do not require a particular pushc version unless the task
   names one.
4. Run `pushc targets --json` (plus `--config <path>` when the user supplied a config) to validate
   the configuration and discover usable destinations. This does not test platform connectivity.
5. If pushc reports that no config exists, stop the preflight and read
   [reference/configuration.md](reference/configuration.md) completely before helping the user
   create one. If a config exists but is invalid, use the same reference to diagnose it. Never send a
   test notification unless the user asks for one.

`config.toml` is non-sensitive and may be read and edited. It must contain only placeholders for
tokens, keys, passwords, credentials, and private endpoint URLs. Never read, print, or modify an
adjacent `.env`; pushc itself may load it at runtime. Prefer environment interpolation for every
credential.

## Commands

### `pushc targets`

Prerequisite: finish the preflight and ensure a configuration exists. Use this command to validate
the configuration and list available destinations before sending.

```bash
pushc targets --json
```

Add `--config <path>` only when the user supplies or selects a non-default config.

### `pushc send`

Prerequisite: know the intended destination from `pushc targets` and have non-empty message content
or at least one attachment. For a real send, also require user intent to perform the external side
effect.

Send a basic message:

```bash
pushc send --target alerts:release "Build completed"
```

Always pass `--target <adapter[:target]>`. A destination without a colon selects that adapter's
default target and does not select its sole named target.

Add `--title` when the configured destination uses a title. Do not use titles to pass secrets:

```bash
pushc send --target alerts:release --title "Build completed" "Production deployment succeeded"
```

Add string extension parameters with `--param key=value` when the configured destination uses them.
Repeat the complete option for every entry, and do not use params to pass secrets:

```bash
pushc send --target alerts:release \
  --param group=deployments \
  --param level=active \
  "Production deployment succeeded"
```

When the selected destination supports attachments, repeat the complete `--attachment <source>`
option for every source. Read the selected adapter's reference before choosing source formats or
relying on attachment-only sends:

```bash
pushc send --target alerts:release \
  --attachment <first-source> \
  --attachment <second-source> \
  "Build completed"
```

Attachment support and source interpretation depend on the selected destination, so do not assume
unsupported behavior. Do not place credentials in attachment URLs or invent attachment paths; use
only sources the user supplied or explicitly selected.

Add `--dry-run` when the user asks to preview or validate a send:

```bash
pushc send --target alerts:release --dry-run "Build completed"
```

A successful dry-run means the send was prepared, not performed. Attachment preparation follows the
selected destination's rules.

For longer message content, use a UTF-8 file or piped stdin:

```bash
pushc send --target alerts:release --file ./report.txt
git log -1 | pushc send --target alerts:release
```

Do not combine positional content with `--file`.

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
