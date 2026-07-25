# Pushc

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/yjl9903/pushc)
[![version](https://img.shields.io/npm/v/pushc?label=pushc)](https://www.npmjs.com/package/pushc)
[![CI](https://github.com/yjl9903/pushc/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/pushc/actions/workflows/ci.yml)

Pushing any messages to anywhere, an agent-friendly CLI for pushing messages.

Now pushc supports adapters:

- HTTP webhook
- NapCat for QQ

## Install

Copy this to your agent:

```text
Install pushc skill from https://github.com/yjl9903/pushc
```

Or install pushc CLI manually.

```bash
npm install -g pushc
```

## Use the CLI

### Configure

Example `.pushc/config.toml`:

```toml
[adapters.bark]
type = "webhook"
url = "https://api.day.app/push"

[adapters.bark.request]
content_type = "application/json"

[adapters.bark.request.body]
device_key = "${BARK_DEVICE_KEY}"
body = "{{message}}"
title = "{{title:-pushc}}"
group = "{{param.group:-pushc}}"
level = "active"

[adapters.bark.response]

[adapters.qq]
type = "napcat"
base_url = "ws://127.0.0.1:3001"
access_token = "${NAPCAT_TOKEN}"
max_attachment_bytes = 33554432

[adapters.qq.targets.qq-group]
group_id = "123456789"

[adapters.qq.targets.qq-friend]
user_id = "987654321"
```

Example `.pushc/.env`:

```dotenv
BARK_DEVICE_KEY=replace-with-your-bark-device-key

NAPCAT_TOKEN=replace-with-your-napcat-token
```

### Commands

Pass short messages as arguments:

```bash
pushc send --target bark \
  --title "Build completed" \
  --param group=releases \
  "Production deployment succeeded"
```

Preview the request without sending it:

```bash
pushc send --target bark \
  --dry-run --json \
  --title "Build completed" \
  --param group=releases \
  "Production deployment succeeded"
```

Read a longer message from a UTF-8 file:

```bash
pushc send --target qq:qq-group --file ./report.txt
```

Send local or remote attachments:

```bash
pushc send --target qq:qq-group \
  --attachment ./screenshot.png \
  --attachment https://example.com/report.pdf
```

Attachment support and source interpretation depend on the selected adapter.

Or pipe it through stdin:

```bash
git log -1 | pushc send --target bark
```

List configured targets:

```bash
pushc targets
```

## Use as a library

Use adapters with `PushClient`:

```ts
import { PushClient } from '@pushc/core';
import { WebhookAdapter } from '@pushc/adapter-webhook';

const client = new PushClient();

client.adapters.register(
  'bark',
  new WebhookAdapter({
    url: 'https://api.day.app/push',
    request: {
      content_type: 'application/json',
      body: {
        device_key: process.env.BARK_DEVICE_KEY!,
        body: '{{message}}',
        title: '{{title:-pushc}}',
        group: '{{param.group:-pushc}}',
        level: 'active'
      }
    }
  })
);

await client.send('bark', {
  title: 'Production',
  message: 'Build completed',
  param: { group: 'deployments' }
});

await client.destroy();
```

## License

MIT License © 2026 [OneKuma](https://github.com/yjl9903)
