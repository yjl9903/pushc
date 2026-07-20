# Pushc

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/yjl9903/pushc)
[![version](https://img.shields.io/npm/v/pushc?label=pushc)](https://www.npmjs.com/package/pushc)
[![CI](https://github.com/yjl9903/pushc/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/pushc/actions/workflows/ci.yml)

Pushing any messages to anywhere, an agent-friendly CLI for pushing messages.

Now pushc supports adapters:

- HTTP webhook
- NapCat for QQ

## Install

```bash
npm install -g pushc
```

## Use the CLI

### Configure

Example `.pushc/config.toml`:

```toml
[adapters.deploy-webhook]
type = "webhook"
url = "https://example.com/hook"

[adapters.deploy-webhook.targets.deploy]

[adapters.deploy-webhook.targets.deploy.body]
text = "{{message}}"

[adapters.qq]
type = "napcat"
base_url = "ws://127.0.0.1:3001"

[adapters.qq.targets.qq-group]
group_id = "123456789"

[adapters.qq.targets.qq-friend]
user_id = "987654321"
```

### Commands

Pass short messages as arguments:

```bash
pushc send --target deploy-webhook:deploy "Build completed"
```

Read a longer message from a UTF-8 file:

```bash
pushc send --target qq:qq-group --file ./report.txt
```

Or pipe it through stdin:

```bash
git log -1 | pushc send --target deploy-webhook:deploy
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

client.adapters.register('webhook', new WebhookAdapter({ url: 'https://example.com/hook' }));

await client.send({
  adapter: 'webhook',
  target: {
    body: {
      text: '{{message}}'
    }
  },
  message: {
    content: 'Build completed'
  }
});

await client.destroy();
```

## License

MIT License © 2026 [XLor](https://github.com/yjl9903)
