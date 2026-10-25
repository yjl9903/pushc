# Grok Bot adapter

Read this reference before configuring a `type = "grok-bot"` adapter or triggering a Routine.
A real send starts work in the user's Grok Bot. Require user intent for that action; use dry-run
when only validating a request.

## Configure

Create a Routine with a webhook trigger in the Bot, then use its full HTTPS URL and corresponding
key. Do not infer the endpoint from a bot/routine ID or use an xAI model API key. The key must be the
raw token without `Bearer `, whitespace or templates. Keep both values in environment variables;
never read, print or modify a real `.env`.

```toml
[adapters.grok]
type = "grok-bot"
url = "${GROK_BOT_WEBHOOK_URL}"
key = "${GROK_BOT_WEBHOOK_KEY}"
# timeout_ms = 10000
```

The default destination is `grok`. Targets may
independently override timeout, body or content type. Replacing a Routine requires URL and key
together, with the same origin as the adapter URL. Use separate adapters for different origins.
`pushc targets --json` validates these rules without network traffic.

## Message body

With no explicit body, JSON requests contain `message`, plus `title` and `param` only when provided.
Multiple text nodes concatenate without a separator. Empty titles and empty param Maps are
preserved; param keys stay flat and values stay strings. Attachments are unsupported.

Customize the body to match the Routine instruction, with arbitrary fields and nesting:

```toml
[adapters.grok.body]
task = "{{message}}"
subject = "{{title}}"
event = "{{param.event:-notification}}"
metadata = { source = "pushc", priority = 1 }
```

Custom bodies do not receive default message/title/param fields. Both adapter and target may supply
any JSON value. When both bodies are objects, top-level keys merge with target values winning;
nested objects replace as units. Other values replace the entire inherited body. Explicit empty
values do not trigger defaults; an empty object still participates in object merge. Null is available
through the library API, since TOML has no null literal.

String values recursively support `{{message}}`, `{{title}}`, `{{param.key}}`, `:-fallback` and
backslash escapes. Object keys and non-string values are unchanged. Replacement values are not
rendered again or parsed as JSON. A string root is encoded as a JSON string. For raw text, set
`content_type = "text/plain"` and use a string body; omitted body in text mode sends the message.
Text mode is supported by the transport but has not been verified against a real Routine.
Valid message content is still required even when a custom body does not reference it.

## Send and interpret results

```bash
pushc send "Review this build" --target grok --param event=build.completed --dry-run --json
```

Remove `--dry-run` only when the user intends to trigger the Routine. Dry-run makes no HTTP request.
A real send uses POST with Bearer authorization. HTTP 200 means the Routine was triggered, not that
the task completed. Check the Bot chat or run history for results. Other HTTP statuses fail, including
201, 202 and 204. No response JSON schema is required.

Do not automatically retry a timeout or other failure: the Routine may already have started.
There is no completion polling or exactly-once guarantee. CLI results redact configuration values;
library receipts retain the full request and should be treated as sensitive.
