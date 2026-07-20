export type WebhookBodyMode = 'json' | 'text';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface WebhookConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  timeout_ms: number;
}

export interface WebhookTargetConfig {
  body_mode: WebhookBodyMode;
  body: JsonValue;
}

export interface WebhookReceipt {
  status: number;
  statusText: string;
}

export interface CreateWebhookAdapterOptions {
  fetch?: typeof globalThis.fetch;
}
