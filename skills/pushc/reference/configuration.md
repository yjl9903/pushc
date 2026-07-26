# Pushc configuration

Read this guide when pushc has no usable configuration or reports configuration or adapter errors.

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

A ready-to-adapt [config.toml](../example/config.toml) contains several optional adapter examples.
Copy only the sections the user needs. Use the accompanying
[.env.example](../example/.env.example) to identify the required environment variables, but never
copy its placeholder values into a real `.env`, inspect an existing `.env`, or enable unrelated
adapters.

Read the reference matching the configured adapter before creating or changing its table:

- [Webhook adapter](webhook.md)
- [NapCat adapter](napcat.md)

## Protect credentials

Pushc loads a `.env` file beside `config.toml` without overriding variables already present in the
process environment. Any config string can interpolate `${VARIABLE_NAME}`. A referenced variable
must exist.

`config.toml` is deliberately non-sensitive and may be read and edited by an agent. Keep secrets such
as private endpoint URLs, access tokens, keys, and passwords in `.env` or the process environment,
restrict permissions where appropriate, and ensure `.env` is ignored by version control. An agent
must never read, print, or modify `.env`; it may only add or update `${VARIABLE_NAME}` placeholders
in `config.toml`.

Using `${VARIABLE_NAME}` does not by itself mean a value is secret. Tokens, keys, passwords,
credential-bearing URLs, and private endpoints must stay outside `config.toml`. Ordinary connection
settings and destination identifiers may be written directly in `config.toml` when the user prefers.

## Validate

Run:

```bash
pushc targets --json
```

Add `--config <path>` when validating a non-discovered file. A successful result confirms that the
configuration parses and every target validates. It does not establish platform connectivity or
send a notification.

After validation, report the available destinations and ask the user which one to use if it is not
already clear. Do not add a speculative test target or send a test message without approval.
