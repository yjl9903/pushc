import { PushError } from '@pushc/core';
import {
  parseWebhookConfig,
  parseWebhookTargetPartial,
  resolveWebhookTarget,
  type WebhookConfig
} from '@pushc/adapter-webhook';
import { z } from 'zod';
import type { GrokBotConfig } from './types.js';

const configSchema = z.strictObject({
  url: z.string(),
  key: z.string(),
  timeout_ms: z.number().optional(),
  content_type: z.string().optional(),
  body: z.unknown().optional()
});
const targetSchema = configSchema.partial();

export function invalidGrokBotConfig(cause?: unknown): PushError {
  return new PushError('INVALID_CONFIG', 'Invalid Grok Bot configuration.', { cause });
}

export function toWebhookConfig(config: GrokBotConfig): WebhookConfig {
  return parseWebhookConfig({
    url: config.url,
    request: {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.key}` },
      timeout_ms: config.timeout_ms,
      content_type: config.content_type,
      body: config.body
    },
    response: { status: 200 }
  });
}

export function parseGrokBotConfig(input: unknown): GrokBotConfig {
  try {
    const parsed = configSchema.parse(input);
    validateKey(parsed.key);
    const webhook = parseWebhookConfig({
      url: parsed.url,
      request: {
        timeout_ms: parsed.timeout_ms,
        content_type: parsed.content_type ?? 'application/json',
        body: parsed.body
      }
    });
    if (new URL(webhook.url).protocol !== 'https:') throw invalidGrokBotConfig();
    return {
      url: webhook.url,
      key: parsed.key,
      timeout_ms: webhook.request.timeout_ms,
      content_type: webhook.request.content_type!,
      ...(webhook.request.body === undefined ? {} : { body: webhook.request.body })
    };
  } catch (cause) {
    throw invalidGrokBotConfig(cause);
  }
}

export function resolveGrokBotTarget(base: GrokBotConfig, input: unknown): GrokBotConfig {
  try {
    const partial = targetSchema.parse(input);
    if ((partial.url === undefined) !== (partial.key === undefined)) {
      throw invalidGrokBotConfig();
    }
    // Validate the replacement connection independently; body validation follows the merge.
    const connection =
      partial.url === undefined ? base : parseGrokBotConfig({ url: partial.url, key: partial.key });
    if (new URL(connection.url).origin !== new URL(base.url).origin) {
      throw invalidGrokBotConfig();
    }
    const { request } = resolveWebhookTarget(
      toWebhookConfig(base),
      parseWebhookTargetPartial({
        request: {
          timeout_ms: partial.timeout_ms,
          content_type: partial.content_type,
          body: partial.body
        }
      })
    );
    return {
      url: connection.url,
      key: connection.key,
      timeout_ms: request.timeout_ms,
      content_type: request.content_type!,
      ...(request.body === undefined ? {} : { body: request.body })
    };
  } catch (cause) {
    throw invalidGrokBotConfig(cause);
  }
}

function validateKey(key: string): void {
  if (
    key === '' ||
    /[\s\u0000-\u001f\u007f-\u009f]/u.test(key) ||
    /^Bearer(?:\s|$)/i.test(key) ||
    key.includes('{{')
  ) {
    throw invalidGrokBotConfig();
  }
}
