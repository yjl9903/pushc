# @pushc/adapter-grok-bot

[![version](https://img.shields.io/npm/v/@pushc/adapter-grok-bot?label=@pushc/adapter-grok-bot)](https://www.npmjs.com/package/@pushc/adapter-grok-bot)
[![CI](https://github.com/yjl9903/pushc/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/pushc/actions/workflows/ci.yml)

Grok Bot Routine webhook adapter for pushc.

## Installation

```bash
npm i @pushc/adapter-grok-bot
```

## Usage

Set the webhook URL and key from your Routine in the environment variables below. Use the raw key
without a `Bearer ` prefix.

```ts
import { GrokBotAdapter } from '@pushc/adapter-grok-bot';

const adapter = new GrokBotAdapter({
  url: process.env.GROK_BOT_WEBHOOK_URL!,
  key: process.env.GROK_BOT_WEBHOOK_KEY!
});

await adapter.send(undefined, {
  content: 'Review the completed build',
  title: 'Build completed',
  param: new Map([['event', 'build.completed']])
});
```

A successful send means the Routine was triggered. Check the Bot chat or run history for its result.

For custom bodies, named targets and CLI setup, see the
[configuration guide](../../skills/pushc/reference/grok-bot.md).

## License

MIT License © 2026 [OneKuma](https://github.com/yjl9903)
