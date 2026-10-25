import {
  PushAdapter,
  PushError,
  type NormalizedPushPayload,
  type PushAdapterOperationOptions,
  type PushDispatchResult,
  type PushPreparedRequest
} from '@pushc/core';

import {
  buildWebhookRequest,
  sendWebhook,
  WebhookError,
  type JsonValue,
  type WebhookDispatchPlan,
  type WebhookRequestReceipt,
  type WebhookResponseReceipt
} from '@pushc/adapter-webhook';

import type { CreateGrokBotAdapterOptions, GrokBotConfig } from './types.js';

import {
  invalidGrokBotConfig,
  parseGrokBotConfig,
  resolveGrokBotTarget,
  toWebhookConfig
} from './config.js';

export class GrokBotAdapter extends PushAdapter<
  GrokBotConfig,
  GrokBotConfig,
  WebhookRequestReceipt,
  WebhookResponseReceipt,
  WebhookDispatchPlan
> {
  readonly #fetch: typeof globalThis.fetch;
  readonly #origin: string;

  constructor(config: unknown, options: CreateGrokBotAdapterOptions = {}) {
    const parsed = parseGrokBotConfig(config);
    super(parsed);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#origin = new URL(parsed.url).origin;
  }

  parseTarget(input: unknown): GrokBotConfig {
    return resolveGrokBotTarget(this.config, input);
  }

  protected async prepareRequest(
    target: GrokBotConfig,
    payload: NormalizedPushPayload,
    _options: PushAdapterOperationOptions
  ): Promise<PushPreparedRequest<WebhookRequestReceipt, WebhookDispatchPlan>> {
    if (payload.content.some((item) => item.type === 'attachment')) {
      throw new PushError('INVALID_MESSAGE', 'Grok Bot does not support attachments.');
    }
    try {
      const config = toWebhookConfig({
        ...target,
        body: target.body === undefined ? defaultBody(target, payload) : target.body
      });
      const request = buildWebhookRequest(config.request, this.#origin, payload);
      return {
        receiptRequest: request,
        transportRequest: { request, responsePolicy: config.response }
      };
    } catch (cause) {
      if (cause instanceof WebhookError) throw invalidGrokBotConfig(cause);
      throw cause;
    }
  }

  protected async dispatchRequest(
    prepared: PushPreparedRequest<WebhookRequestReceipt, WebhookDispatchPlan>,
    options: PushAdapterOperationOptions
  ): Promise<PushDispatchResult<never, WebhookResponseReceipt>> {
    const result = await sendWebhook(this.#fetch, prepared.transportRequest, options);
    return result.success
      ? { ...result, summary: 'Grok Bot routine triggered (HTTP 200).' }
      : result;
  }
}

function defaultBody(config: GrokBotConfig, payload: NormalizedPushPayload): JsonValue {
  if (config.content_type.startsWith('text/plain')) return '{{message}}';
  // Use templates so normalized values are inserted once, never scanned again.
  return {
    message: '{{message}}',
    ...(payload.title === undefined ? {} : { title: '{{title}}' }),
    ...(payload.param === undefined
      ? {}
      : {
          param: Object.fromEntries(
            [...payload.param.keys()].map((key) => [key, `{{param.${key}}}`])
          )
        })
  };
}
