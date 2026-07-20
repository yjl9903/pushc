import { PushAdapter, type AdapterSendContext } from '@pushc/core';

import type {
  CreateWebhookAdapterOptions,
  WebhookConfig,
  WebhookReceipt,
  WebhookTargetConfig
} from './types.js';

import { sendWebhook } from './request.js';
import { parseWebhookConfig } from './config.js';
import { parseWebhookTarget, parseWebhookTargetPartial, webhookTargetDefaults } from './target.js';

export class WebhookAdapter extends PushAdapter<
  WebhookConfig,
  WebhookTargetConfig,
  WebhookReceipt
> {
  readonly #fetch: typeof globalThis.fetch;
  readonly #targetDefaults: Readonly<Record<string, unknown>>;

  constructor(config: unknown, options: CreateWebhookAdapterOptions = {}) {
    super(parseWebhookConfig(config));
    this.#targetDefaults = webhookTargetDefaults(config);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  parseTarget(input: unknown): WebhookTargetConfig {
    return parseWebhookTarget({
      ...this.#targetDefaults,
      ...parseWebhookTargetPartial(input)
    });
  }

  protected sendTarget({ target, message, signal }: AdapterSendContext<WebhookTargetConfig>) {
    return sendWebhook(this.#fetch, this.config, target, message.content, signal);
  }
}
