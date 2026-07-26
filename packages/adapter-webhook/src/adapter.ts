import {
  PushAdapter,
  PushError,
  type NormalizedPushPayload,
  type PushAdapterOperationOptions,
  type PushDispatchResult,
  type PushPreparedRequest
} from '@pushc/core';

import type {
  CreateWebhookAdapterOptions,
  WebhookConfig,
  WebhookRequestReceipt,
  WebhookResponseReceipt,
  WebhookTargetConfig
} from './types.js';

import { WebhookError } from './error.js';
import { buildWebhookRequest, sendWebhook } from './request.js';
import { parseWebhookConfig, parseWebhookTargetPartial, resolveWebhookTarget } from './config.js';

export class WebhookAdapter extends PushAdapter<
  WebhookConfig,
  WebhookTargetConfig,
  WebhookRequestReceipt,
  WebhookResponseReceipt
> {
  readonly #fetch: typeof globalThis.fetch;
  readonly #origin: string;

  constructor(config: unknown, options: CreateWebhookAdapterOptions = {}) {
    const parsed = parseWebhookConfig(config);
    super(parsed);
    this.#origin = new URL(parsed.url).origin;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  parseTarget(input: unknown): WebhookTargetConfig {
    try {
      return resolveWebhookTarget(this.config, parseWebhookTargetPartial(input));
    } catch (error) {
      if (error instanceof WebhookError && error.code === 'INVALID_CONFIG') {
        throw new PushError('INVALID_CONFIG', error.message, { cause: error });
      }
      throw error;
    }
  }

  protected async prepareRequest(
    target: WebhookTargetConfig,
    payload: NormalizedPushPayload,
    _options: PushAdapterOperationOptions
  ): Promise<PushPreparedRequest<WebhookRequestReceipt, WebhookRequestReceipt>> {
    try {
      if (payload.content.some((item) => item.type === 'attachment')) {
        throw new PushError('INVALID_MESSAGE', 'Webhook does not support attachments.');
      }

      const request = buildWebhookRequest(target.request, this.#origin, payload);
      return { receiptRequest: request, transportRequest: request };
    } catch (error) {
      if (error instanceof WebhookError && error.code === 'INVALID_CONFIG') {
        throw new PushError('INVALID_CONFIG', error.message, { cause: error });
      } else {
        throw error;
      }
    }
  }

  protected async dispatchRequest(
    prepared: PushPreparedRequest<WebhookRequestReceipt, WebhookRequestReceipt>,
    options: PushAdapterOperationOptions
  ): Promise<PushDispatchResult<never, WebhookResponseReceipt>> {
    return await sendWebhook(this.#fetch, prepared.transportRequest, options);
  }
}
