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
  content: ['Build ', 'completed'],
  param: { group: 'deployments' }
});

await client.destroy();
```

## License

MIT License © 2026 [OneKuma](https://github.com/yjl9903)
