# @pushc/adapter-napcat

[![version](https://img.shields.io/npm/v/@pushc/adapter-napcat?label=@pushc/adapter-napcat)](https://www.npmjs.com/package/@pushc/adapter-napcat)
[![CI](https://github.com/yjl9903/pushc/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/pushc/actions/workflows/ci.yml)

NapCat QQ adapter for pushc.

## Installtion

```bash
npm i @pushc/adapter-napcat
```

## Usage

```ts
import { NapCatAdapter } from '@pushc/adapter-napcat';

const adapter = new NapCatAdapter({
  base_url: 'ws://127.0.0.1:3001',
  access_token: process.env.NAPCAT_TOKEN,
  max_attachment_bytes: 32 * 1024 * 1024
});

await adapter.send(
  {
    group_id: '123456789'
  },
  {
    message: 'Build completed',
    attachments: ['./screenshot.png', 'https://example.com/report.pdf']
  }
);

await adapter.destroy();
```

## License

MIT License © 2026 [XLor](https://github.com/yjl9903)
