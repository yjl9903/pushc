import { NapCatError } from './error.js';
import type { NapCatConfig } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const CONFIG_FIELDS = new Set([
  'base_url',
  'access_token',
  'timeout_ms',
  'max_attachment_bytes',
  'user_id',
  'group_id'
]);

export function parseNapCatConfig(input: unknown): NapCatConfig {
  const value = record(input, 'NapCat configuration must be a table.');
  rejectUnknownFields(value);
  const baseUrl = requiredString(value.base_url, 'base_url');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new NapCatError('INVALID_CONFIG', 'base_url must be a valid WebSocket URL.');
  }
  if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
    throw new NapCatError('INVALID_CONFIG', 'base_url must use the ws or wss protocol.');
  }

  const accessToken = optionalString(value.access_token, 'access_token');

  return {
    base_url: parsedUrl.toString(),
    ...(accessToken ? { access_token: accessToken } : {}),
    timeout_ms: positiveInteger(value.timeout_ms, 'timeout_ms', DEFAULT_TIMEOUT_MS),
    max_attachment_bytes: positiveInteger(
      value.max_attachment_bytes,
      'max_attachment_bytes',
      DEFAULT_MAX_ATTACHMENT_BYTES
    )
  };
}

function rejectUnknownFields(value: Record<string, unknown>): void {
  for (const field of Object.keys(value)) {
    if (!CONFIG_FIELDS.has(field)) {
      throw new NapCatError('INVALID_CONFIG', `Unknown NapCat configuration field "${field}".`);
    }
  }
}

function positiveInteger(input: unknown, path: string, fallback: number): number {
  if (input === undefined) return fallback;
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) {
    throw new NapCatError('INVALID_CONFIG', `${path} must be a positive integer.`);
  }
  return input;
}

function requiredString(input: unknown, path: string): string {
  const value = optionalString(input, path);
  if (!value) throw new NapCatError('INVALID_CONFIG', `${path} is required.`);
  return value;
}

function optionalString(input: unknown, path: string): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string') {
    throw new NapCatError('INVALID_CONFIG', `${path} must be a string.`);
  }
  return input.trim();
}

function record(input: unknown, message: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new NapCatError('INVALID_CONFIG', message);
  }
  return input as Record<string, unknown>;
}
