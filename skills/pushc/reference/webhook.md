# Webhook adapter

Read this reference before configuring a `type = "webhook"` adapter or relying on its send,
attachment, dry-run, receipt, or error behavior.

## Contents

- [Configuration](#configuration)
- [Payload templates](#payload-templates)
- [Request and attachment behavior](#request-and-attachment-behavior)
- [Dry run, sending, and receipts](#dry-run-sending-and-receipts)

## Configuration

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

[adapters.deploy.response]
status = "2xx"

[adapters.deploy.response.body]
"/accepted" = { equals = true }

[adapters.deploy.response.headers]
x-request-id = { exists = true }

[adapters.deploy.targets.release.request]
url = "${DEPLOY_WEBHOOK_URL}/release"

[adapters.deploy.targets.release.request.headers]
X-Release = "{{param.release:-current}}"
```

The top-level adapter fields are:

- `url` (required): a static absolute HTTP or HTTPS URL without credentials or templates. It defines
  the trusted origin for every request URL.
- `request`: optional request configuration.
- `response`: optional success policy with `status`, JSON `body` assertions, and sanitized
  `headers` assertions.

The adapter and each named target accept the following `request` fields:

- `url`: optional request URL, defaulting to top-level `url`. It may use send-time templates but must
  resolve to an absolute HTTP(S) URL with the same origin as the top-level URL.
- `method`: HTTP method, default `POST`. Invalid HTTP tokens and `CONNECT`, `TRACE`, or `TRACK` are
  rejected.
- `headers`: string-valued header table, default empty.
- `content_type`: `application/json` or `text/plain`, optionally with `charset=utf-8`. When a body
  exists and this field is absent, it defaults to `application/json`.
- `timeout_ms`: integer from `1` through `2147483647`, default `10000`.
- `body`: optional JSON-compatible TOML value or string. There is no default body.

A target may contain only `request` and `response`. Target request scalars
override adapter values. Headers merge by case-insensitive name, with the target value winning.
Plain JSON object bodies merge at the top level; every other target body replaces the inherited
body.

`response.status` accepts `"2xx"` (the default), one HTTP status, or a non-empty array of statuses.
`response.body` maps RFC 6901 JSON Pointers to strict `{ equals = ... }` or
`{ exists = boolean }` rules. `response.headers` maps case-insensitive header names to the same
operations, with string-only equality. All rules must pass. Target response fields inherit
independently; an explicitly configured body or headers table replaces that entire group, and an
empty table clears it.

For an adapter with no named targets, configure the request on the adapter and send to the adapter
name, such as `deploy`. Defining a single named target does not make it the default.

## Payload templates

Webhook request templates use the same single-pass syntax as message content. They are supported in
`request.url`, header values, and string values inside `request.body`:

- `{{message}}` uses the already-rendered message text. Multiple text nodes join in order without a
  separator.
- `{{title}}` uses the optional title.
- `{{param.key}}` uses the effective message param after structured-message values and CLI
  overrides are merged.
- `{{title:-pushc}}` and equivalent expressions use the fallback when the value is missing or empty.

Each message-content or Webhook-request rendering pass scans its own template once; replacements
and fallbacks are not processed again. Unknown,
invalid, or unclosed expressions remain literal. Prefix an opening expression with `\` to escape it.
Templates do not perform URL or JSON encoding.

Only template positions consume `message`, `title`, and params. A field omitted from the configured
request is not added automatically.

## Request and attachment behavior

The adapter renders the selected request, then validates the final URL, method, headers, content
type, and body before sending:

- JSON content serializes a JSON-shaped body. Text content requires a string body.
- A body with no explicit Content-Type receives the configured or default content type.
- A request without a body sends no body and does not add Content-Type.
- `GET` and `HEAD` reject a configured body.
- The final request URL must remain on the top-level URL's origin and contain no credentials.

Webhook destinations do not support attachments, whether passed with `--attachment` or declared as
an attachment node. They fail with `INVALID_MESSAGE` and are never ignored or converted to multipart
data.

## Dry run, sending, and receipts

`--dry-run` renders and validates the complete request without calling the endpoint. Its receipt
contains the prepared request and no response. A successful dry run confirms local preparation only.

A real send performs one HTTP request. HTTP status 200 through 299 is successful by default; an
explicit response status policy replaces that matcher. The adapter then checks body rules followed
by header rules. It does not retry.

The receipt request contains the final URL, method, normalized headers, content type, timeout, and
rendered body. CLI output redacts configuration-derived secrets. The response receipt contains the
status, sanitized headers, and a best-effort parsed JSON body. Body rules can only inspect that
parsed JSON; header rules can only inspect the sanitized headers. Summaries identify the HTTP
method, destination host, and status.

Status mismatches, assertion failures, timeouts, cancellation, and network errors return a failed
send with every available receipt field. Assertion errors identify only the configured body path or
header name, not response values. Request validation and adapter configuration failures use
`INVALID_CONFIG`; HTTP request failures surface through `SEND_FAILED`. Do not retry automatically
because an ambiguous network failure may have reached the endpoint.
