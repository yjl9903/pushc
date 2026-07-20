# @pushc/core

[![version](https://img.shields.io/npm/v/@pushc/adapter-core?label=@pushc/adapter-core)](https://www.npmjs.com/package/@pushc/adapter-core)
[![CI](https://github.com/yjl9903/pushc/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/pushc/actions/workflows/ci.yml)

Runtime-neutral registries and orchestration primitives for `pushc`.

## Installtion

```bash
npm i @pushc/core @pushc/adapter-webhook
```

## Usage

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
