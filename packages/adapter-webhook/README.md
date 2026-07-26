# @pushc/adapter-webhook

[![version](https://img.shields.io/npm/v/@pushc/adapter-webhook?label=@pushc/adapter-webhook)](https://www.npmjs.com/package/@pushc/adapter-webhook)
[![CI](https://github.com/yjl9903/pushc/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/pushc/actions/workflows/ci.yml)

Universal HTTP webhook adapter for pushc.

## Installation

```bash
npm i @pushc/adapter-webhook
```

## Usage

```ts
import { WebhookAdapter } from '@pushc/adapter-webhook';

const adapter = new WebhookAdapter({
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
});

await adapter.send(undefined, {
  title: 'Production',
  content: 'Build completed',
  param: { group: 'releases' }
});
```

## License

MIT License © 2026 [OneKuma](https://github.com/yjl9903)
