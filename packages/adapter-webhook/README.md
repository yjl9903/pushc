# @pushc/adapter-webhook

[![version](https://img.shields.io/npm/v/@pushc/adapter-webhook?label=@pushc/adapter-webhook)](https://www.npmjs.com/package/@pushc/adapter-webhook)
[![CI](https://github.com/yjl9903/pushc/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/pushc/actions/workflows/ci.yml)

HTTP webhook adapter for pushc.

## Installation

```bash
npm i @pushc/adapter-webhook
```

## Usage

```ts
import { WebhookAdapter } from '@pushc/adapter-webhook';

const adapter = new WebhookAdapter({
  url: 'https://example.com/hook',
  headers: { Authorization: 'Bearer token' }
});

await adapter.send({
  target: {
    body: {
      text: '{{message}}'
    }
  },
  message: {
    content: 'Build completed'
  }
});

await adapter.destroy();
```

## License

MIT License © 2026 [XLor](https://github.com/yjl9903)
