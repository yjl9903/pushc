import { WebhookError } from './error.js';
import type { JsonValue, WebhookTargetConfig } from './types.js';

const TARGET_FIELDS = new Set(['body_mode', 'body']);

export function webhookTargetDefaults(input: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(input)) return {};
  return Object.freeze(
    Object.fromEntries(
      [...TARGET_FIELDS].filter((field) => field in input).map((field) => [field, input[field]])
    )
  );
}

export function parseWebhookTarget(input: unknown): WebhookTargetConfig {
  const value = record(input, 'Webhook target configuration must be a table.');
  rejectUnknownTargetFields(value);
  const bodyMode = optionalString(value.body_mode, 'body_mode') ?? 'json';
  if (bodyMode !== 'json' && bodyMode !== 'text') {
    throw new WebhookError('INVALID_CONFIG', 'body_mode must be either "json" or "text".');
  }

  const body = parseJsonValue(
    value.body ?? (bodyMode === 'json' ? { text: '{{message}}' } : '{{message}}'),
    'body'
  );
  if (bodyMode === 'text' && typeof body !== 'string') {
    throw new WebhookError('INVALID_CONFIG', 'body must be a string when body_mode is "text".');
  }
  return { body_mode: bodyMode, body };
}

export function parseWebhookTargetPartial(input: unknown): Record<string, unknown> {
  const value = record(input, 'Webhook target configuration must be a table.');
  rejectUnknownTargetFields(value);
  return value;
}

function rejectUnknownTargetFields(value: Record<string, unknown>): void {
  for (const field of Object.keys(value)) {
    if (!TARGET_FIELDS.has(field)) {
      throw new WebhookError(
        'INVALID_CONFIG',
        `Webhook targets cannot override adapter field "${field}".`
      );
    }
  }
}

export function renderWebhookBody(value: JsonValue, message: string): JsonValue {
  if (typeof value === 'string') return value.replaceAll('{{message}}', message);
  if (Array.isArray(value)) return value.map((item) => renderWebhookBody(item, message));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderWebhookBody(item, message)])
    );
  }
  return value;
}

function parseJsonValue(input: unknown, path: string): JsonValue {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'bigint' && Number.isSafeInteger(Number(input))) return Number(input);
  if (Array.isArray(input)) {
    return input.map((item, index) => parseJsonValue(item, `${path}[${index}]`));
  }
  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, item]) => [key, parseJsonValue(item, `${path}.${key}`)])
    );
  }
  throw new WebhookError(
    'INVALID_CONFIG',
    `${path} contains a value that cannot be encoded as JSON.`
  );
}

function optionalString(input: unknown, path: string): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string') {
    throw new WebhookError('INVALID_CONFIG', `${path} must be a string.`);
  }
  return input.trim();
}

function record(input: unknown, message: string): Record<string, unknown> {
  if (!isRecord(input)) throw new WebhookError('INVALID_CONFIG', message);
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
