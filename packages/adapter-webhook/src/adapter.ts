import { PushAdapter, PushError, type PushPayload, type PushSendOptions } from '@pushc/core';

import type {
  CreateWebhookAdapterOptions,
  WebhookConfig,
  WebhookReceipt,
  WebhookTargetConfig
} from './types.js';

import { buildWebhookRequest, sendWebhook } from './request.js';
import { parseWebhookConfig, parseWebhookTargetPartial, resolveWebhookTarget } from './config.js';
import { WebhookError } from './error.js';

export class WebhookAdapter extends PushAdapter<
  WebhookConfig,
  WebhookTargetConfig,
  WebhookReceipt
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

  protected async sendTarget(
    target: WebhookTargetConfig,
    payload: PushPayload,
    options: Readonly<PushSendOptions>
  ): Promise<WebhookReceipt> {
    if (typeof this.#fetch !== 'function') {
      throw new WebhookError('FETCH_UNAVAILABLE', 'This runtime does not provide fetch.');
    }

    let request;
    try {
      request = buildWebhookRequest(target.request, this.#origin, payload);
    } catch (error) {
      if (error instanceof WebhookError && error.code === 'INVALID_CONFIG') {
        throw new PushError('INVALID_CONFIG', error.message, { cause: error });
      }
      throw error;
    }
    return await sendWebhook(this.#fetch, request, options);
  }
}
