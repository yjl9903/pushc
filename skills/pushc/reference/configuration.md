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

## Protect credentials

Pushc loads a `.env` file beside `config.toml` without overriding variables already present in the
process environment. Any config string can interpolate `${VARIABLE_NAME}`. A referenced variable
must exist.

Keep secrets such as webhook URLs and access tokens in `.env`, restrict its permissions where
appropriate, and ensure it is ignored by version control. Never overwrite an existing config or
`.env`; inspect it first and make the smallest requested edit.

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
method = "POST"
timeout_ms = 10000

[adapters.deploy.headers]
Authorization = "Bearer ${WEBHOOK_TOKEN}"

[adapters.deploy.targets.release]
body_mode = "json"

[adapters.deploy.targets.release.body]
text = "{{message}}"
source = "pushc"
```

Adapter fields:

- `url` (required): HTTP or HTTPS URL.
- `method`: HTTP method, default `POST`.
- `headers`: string-valued header table, default empty.
- `timeout_ms`: positive integer, default `10000`.
- `body_mode` and `body`: optional adapter-level defaults inherited by named targets.

Target fields:

- `body_mode`: `json` (default) or `text`.
- `body`: JSON-compatible TOML value or, in text mode, a string. Every `{{message}}` occurrence in
  string values is replaced with the message. The default body is `{ text = "{{message}}" }` for
  JSON and `"{{message}}"` for text.

Named targets may override only `body_mode` and `body`, not URL, method, headers, or timeout.

For a webhook with no named targets, place `body_mode` and `body` directly on the adapter and send
to `deploy` rather than `deploy:<name>`.

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
define named targets and send to addresses such as `qq:ops-group`.

## Validate

Run:

```bash
pushc targets --json
```

Add `--config <path>` when validating a non-discovered file. A successful result confirms that the
configuration parses, every target validates, and adapters initialize; NapCat initialization also
checks its WebSocket connection. It does not send a notification.

After validation, report the available addresses and ask the user which one to use if it is not
already clear. Do not add a speculative test target or send a test message without approval.
