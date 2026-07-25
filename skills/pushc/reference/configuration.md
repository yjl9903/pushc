# Pushc configuration

Read this guide when pushc has no usable configuration or reports configuration or adapter
initialization errors.

## Choose the config location

Pushc resolves configuration in this order:

1. `--config <path>`
2. `PUSHC_CONFIG`
3. `<current-directory>/.pushc/config.toml`
4. `$XDG_CONFIG_HOME/pushc/config.toml`
5. `~/.config/pushc/config.toml`

An explicit path may name either a TOML file or a directory containing `config.toml`. For a
project-specific setup, prefer `.pushc/config.toml`; for a user-wide setup, prefer
`~/.config/pushc/config.toml`. Ask which scope the user wants before creating files.

The config root contains only an `adapters` table. Adapter and target names must start with a letter
or digit and contain only letters, digits, `_`, or `-`.

## Use the bundled example

A ready-to-adapt [config.toml](../example/config.toml) covers Bark, ntfy, Gotify, Pushover,
and NapCat. Copy only the adapter sections the user needs. Use the accompanying
[.env.example](../example/.env.example) to identify the required environment variables, but never
copy its placeholder values into a real `.env`, inspect an existing `.env`, or enable unrelated
adapters.

## Protect credentials

Pushc loads a `.env` file beside `config.toml` without overriding variables already present in the
process environment. Any config string can interpolate `${VARIABLE_NAME}`. A referenced variable
must exist.

`config.toml` is deliberately non-sensitive and may be read and edited by an agent. Keep secrets such
as private webhook URLs and access tokens in `.env` or the process environment, restrict permissions
where appropriate, and ensure `.env` is ignored by version control. An agent must never read, print,
or modify `.env`; it may only add or update `${VARIABLE_NAME}` placeholders in `config.toml`.

Using `${VARIABLE_NAME}` does not by itself mean a value is secret. Tokens, keys, passwords,
credential-bearing URLs, and private endpoints must stay outside `config.toml`. Ordinary connection
settings and destination identifiers may be written directly in `config.toml` when the user prefers;
examples include a public service URL, a local NapCat `base_url`, a QQ user ID, and a QQ group ID.
The bundled example keeps some of these values in environment variables only to make the same
template reusable across users and machines.

Example `.env`:

```dotenv
DEPLOY_WEBHOOK_URL=https://example.com/private-hook
NAPCAT_TOKEN=replace-with-the-real-token
```

## Configure an HTTP webhook

```toml
[adapters.deploy]
type = "webhook"
url = "${DEPLOY_WEBHOOK_URL}"

[adapters.deploy.request]
method = "POST"
content_type = "application/json"
timeout_ms = 10000

[adapters.deploy.request.headers]
Authorization = "Bearer ${WEBHOOK_TOKEN}"

[adapters.deploy.request.body]
message = "{{message}}"
title = "{{title:-pushc}}"
group = "{{param.group:-deployments}}"
source = "pushc"

[adapters.deploy.targets.release.request]
url = "${DEPLOY_WEBHOOK_URL}/release"

[adapters.deploy.targets.release.request.headers]
X-Release = "{{param.release:-current}}"
```

Adapter fields:

- `url` (required): static HTTP or HTTPS URL. It establishes the trusted origin and does not use
  send-time templates.
- `request`: optional request table containing the fields below.
- `response`: optional empty table reserved for future response parsing. Non-empty tables are
  rejected.
- `request.url`: optional dynamic URL, defaulting to top-level `url`. At either the adapter or target
  level, it must resolve to an absolute HTTP(S) URL with the same origin as the top-level URL.
- `request.method`: HTTP method, default `POST`.
- `request.headers`: string-valued header table, default empty.
- `request.content_type`: `application/json` or `text/plain`, optionally with `charset=utf-8`. When body
  exists and this is omitted, it defaults to `application/json`.
- `request.timeout_ms`: integer from `1` through `2147483647`, default `10000`.
- `request.body`: optional JSON-compatible TOML value or string. There is no default body.

Target fields:

- Targets may override the same fields under `request`.
- `target.response` is also an empty placeholder.
- Headers merge by case-insensitive name. Plain JSON object bodies merge at the top level; any other
  target body replaces the inherited body.

Templates are available in adapter and target `request.url`, header values, and body string values:
`{{message}}`, `{{title}}`, and `{{param.key}}`. `{{title:-pushc}}` and similar expressions use the
fallback when a value is missing or empty. Templates are scanned once and do not perform URL or JSON
encoding.

For a webhook with no named targets, place `body` in `request` and send to `deploy`
rather than `deploy:<name>`. With no body, pushc sends no body and does not add Content-Type.

## Configure NapCat for QQ

NapCat must already be running and expose a reachable WebSocket API.

```toml
[adapters.qq]
type = "napcat"
base_url = "ws://127.0.0.1:3001"
access_token = "${NAPCAT_TOKEN}"
timeout_ms = 10000

[adapters.qq.targets.ops-group]
group_id = "123456789"

[adapters.qq.targets.owner]
user_id = "987654321"
```

Adapter fields:

- `base_url` (required): `ws://` or `wss://` URL.
- `access_token`: optional NapCat access token.
- `timeout_ms`: positive integer, default `10000`.
- `user_id` or `group_id`: optional adapter-level default destination.

Each resolved destination must contain exactly one of `user_id` or `group_id`. IDs contain decimal
digits and must be positive JavaScript-safe integers. Named targets may override only these two
destination fields.

For a default destination, put exactly one ID directly on the adapter and send to `qq`. Otherwise,
define named targets and send to destinations such as `qq:ops-group`.

## Validate

Run:

```bash
pushc targets --json
```

Add `--config <path>` when validating a non-discovered file. A successful result confirms that the
configuration parses and every target validates. It does not establish a NapCat WebSocket connection
or send a notification.

After validation, report the available destinations and ask the user which one to use if it is not
already clear. Do not add a speculative test target or send a test message without approval.
