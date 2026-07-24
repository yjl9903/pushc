export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface WebhookRequestConfig {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly content_type?: string;
  readonly timeout_ms: number;
  readonly body?: JsonValue;
}

export type WebhookResponseConfig = Readonly<Record<string, never>>;

export interface WebhookConfig {
  readonly url: string;
  readonly request: WebhookRequestConfig;
  readonly response: WebhookResponseConfig;
}

export interface WebhookTargetConfig {
  readonly request: WebhookRequestConfig;
  readonly response: WebhookResponseConfig;
}

export interface WebhookRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly timeout_ms: number;
  readonly body?: string;
}

export interface WebhookReceipt {
  readonly status: number;
}

export interface CreateWebhookAdapterOptions {
  readonly fetch?: typeof globalThis.fetch;
}
