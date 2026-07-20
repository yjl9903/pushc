import { WebhookError } from './error.js';
import type { WebhookConfig } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const CONFIG_FIELDS = new Set(['url', 'method', 'headers', 'timeout_ms', 'body_mode', 'body']);

export function parseWebhookConfig(input: unknown): WebhookConfig {
  const value = record(input, 'Webhook configuration must be a table.');
  rejectUnknownFields(value);
  const url = requiredString(value.url, 'url');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new WebhookError('INVALID_CONFIG', 'url must be a valid HTTP or HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new WebhookError('INVALID_CONFIG', 'url must use the HTTP or HTTPS protocol.');
  }

  return {
    url: parsedUrl.toString(),
    method: (optionalString(value.method, 'method') ?? 'POST').toUpperCase(),
    headers: parseHeaders(value.headers),
    timeout_ms: positiveInteger(value.timeout_ms, 'timeout_ms', DEFAULT_TIMEOUT_MS)
  };
}

function rejectUnknownFields(value: Record<string, unknown>): void {
  for (const field of Object.keys(value)) {
    if (!CONFIG_FIELDS.has(field)) {
      throw new WebhookError('INVALID_CONFIG', `Unknown webhook configuration field "${field}".`);
    }
  }
}

function parseHeaders(input: unknown): Record<string, string> {
  if (input === undefined) return {};
  const value = record(input, 'headers must be a table.');
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item !== 'string') {
        throw new WebhookError('INVALID_CONFIG', `headers.${key} must be a string.`);
      }
      return [key, item];
    })
  );
}

function positiveInteger(input: unknown, path: string, fallback: number): number {
  if (input === undefined) return fallback;
  const value = typeof input === 'bigint' ? Number(input) : input;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new WebhookError('INVALID_CONFIG', `${path} must be a positive integer.`);
  }
  return value;
}

function requiredString(input: unknown, path: string): string {
  const value = optionalString(input, path);
  if (!value) throw new WebhookError('INVALID_CONFIG', `${path} is required.`);
  return value;
}

function optionalString(input: unknown, path: string): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string') {
    throw new WebhookError('INVALID_CONFIG', `${path} must be a string.`);
  }
  return input.trim();
}

function record(input: unknown, message: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new WebhookError('INVALID_CONFIG', message);
  }
  return input as Record<string, unknown>;
}
