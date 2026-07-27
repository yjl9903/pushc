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
    title: 'Production',
    param: new Map([['report', 'report.pdf']]),
    content: [
      { type: 'text', text: '{{title}} build completed' },
      { type: 'attachment', source: 'https://example.com/{{param.report}}' }
    ]
  }
);

await adapter.destroy();
```

## License

MIT License © 2026 [OneKuma](https://github.com/yjl9903)
