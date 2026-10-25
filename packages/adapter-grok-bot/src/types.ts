import type { JsonValue } from '@pushc/adapter-webhook';

export interface GrokBotConfig {
  readonly url: string;
  readonly key: string;
  readonly timeout_ms: number;
  readonly content_type: string;
  readonly body?: JsonValue;
}

export interface CreateGrokBotAdapterOptions {
  readonly fetch?: typeof globalThis.fetch;
}
