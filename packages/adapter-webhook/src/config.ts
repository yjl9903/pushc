import { z } from 'zod';

import { WebhookError } from './error.js';
import { isJsonObject, isJsonValue } from './utils/json.js';
import { isRecord } from './utils/record.js';
import type {
  JsonValue,
  WebhookConfig,
  WebhookRequestConfig,
  WebhookResponseConfig,
  WebhookTargetConfig
} from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const requestSchema = z.strictObject({
  url: z.string().optional(),
  method: z.string().optional(),
  headers: z.unknown().optional(),
  content_type: z.string().optional(),
  timeout_ms: z.number().optional(),
  body: z.unknown().optional()
});

const configSchema = z.strictObject({
  url: z.string(),
  request: z.unknown().optional(),
  response: z.unknown().optional()
});

const targetSchema = z.strictObject({
  request: z.unknown().optional(),
  response: z.unknown().optional()
});

interface ParsedWebhookRequestPartial {
  readonly url?: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly content_type?: string;
  readonly timeout_ms?: number;
  readonly body?: JsonValue;
}

interface ParsedWebhookTargetPartial {
  readonly request?: ParsedWebhookRequestPartial;
  readonly response?: WebhookResponseConfig;
}

export interface ParsedContentType {
  readonly value: string;
  readonly essence: 'application/json' | 'text/plain';
}

export function parseWebhookConfig(input: unknown): WebhookConfig {
  try {
    const result = configSchema.safeParse(input);
    if (!result.success) throw invalidConfig(result.error);
    const url = parseAdapterUrl(result.data.url);
    const request = resolveWebhookRequest(
      {
        url,
        method: 'POST',
        headers: {},
        timeout_ms: DEFAULT_TIMEOUT_MS
      },
      parseWebhookRequestInput(result.data.request ?? {})
    );
    return {
      url,
      request,
      response: parseWebhookResponse(result.data.response ?? {})
    };
  } catch (cause) {
    if (cause instanceof WebhookError) throw cause;
    throw invalidConfig(cause);
  }
}

export function parseWebhookTargetPartial(input: unknown): ParsedWebhookTargetPartial {
  const result = targetSchema.safeParse(input);
  if (!result.success) throw invalidConfig(result.error);
  return {
    ...(result.data.request === undefined
      ? {}
      : { request: parseWebhookRequestInput(result.data.request) }),
    ...(result.data.response === undefined
      ? {}
      : { response: parseWebhookResponse(result.data.response) })
  };
}

export function resolveWebhookTarget(
  base: WebhookConfig,
  partial: ParsedWebhookTargetPartial
): WebhookTargetConfig {
  return {
    request: resolveWebhookRequest(base.request, partial.request ?? {}),
    response: {}
  };
}

export function parseContentType(input: string): ParsedContentType {
  const match = /^\s*(application\/json|text\/plain)\s*(?:;\s*charset\s*=\s*(utf-8)\s*)?$/i.exec(
    input
  );
  if (!match) throw invalidConfig();
  const essence = match[1]!.toLowerCase() as ParsedContentType['essence'];
  return {
    value: `${essence}${match[2] === undefined ? '' : '; charset=utf-8'}`,
    essence
  };
}

export function invalidConfig(cause?: unknown): WebhookError {
  return new WebhookError('INVALID_CONFIG', 'Invalid webhook configuration.', {
    cause
  });
}

function parseWebhookRequestInput(input: unknown): ParsedWebhookRequestPartial {
  const result = requestSchema.safeParse(input);
  if (!result.success) throw invalidConfig(result.error);
  return {
    ...(result.data.url === undefined ? {} : { url: result.data.url }),
    ...(result.data.method === undefined ? {} : { method: parseMethod(result.data.method) }),
    ...(result.data.headers === undefined ? {} : { headers: parseHeaders(result.data.headers) }),
    ...(result.data.content_type === undefined
      ? {}
      : { content_type: parseContentType(result.data.content_type).value }),
    ...(result.data.timeout_ms === undefined
      ? {}
      : { timeout_ms: parseTimeout(result.data.timeout_ms) }),
    ...(result.data.body === undefined ? {} : { body: normalizeJsonBody(result.data.body) })
  };
}

function parseWebhookResponse(input: unknown): WebhookResponseConfig {
  if (!isRecord(input) || Object.keys(input).length > 0) throw invalidConfig();
  return {};
}

function resolveWebhookRequest(
  base: WebhookRequestConfig,
  partial: ParsedWebhookRequestPartial
): WebhookRequestConfig {
  const body = mergeBody(base, partial);
  const contentType = partial.content_type ?? base.content_type;
  const resolved: WebhookRequestConfig = {
    url: partial.url ?? base.url,
    method: partial.method ?? base.method,
    headers: mergeHeaders(base.headers, partial.headers),
    ...(contentType === undefined && body !== undefined
      ? { content_type: 'application/json' }
      : contentType === undefined
        ? {}
        : { content_type: contentType }),
    timeout_ms: partial.timeout_ms ?? base.timeout_ms,
    ...(body === undefined ? {} : { body })
  };
  validateMethodBody(resolved.method, resolved.body);
  if (
    resolved.body !== undefined &&
    resolved.content_type !== undefined &&
    parseContentType(resolved.content_type).essence === 'text/plain' &&
    typeof resolved.body !== 'string'
  ) {
    throw invalidConfig();
  }
  return resolved;
}

function parseAdapterUrl(input: string): string {
  if (input.includes('{{')) throw invalidConfig();
  const url = new URL(input);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw invalidConfig();
  }
  return url.toString();
}

function parseMethod(input: string): string {
  const method = input.trim().toUpperCase();
  if (
    !HTTP_TOKEN_PATTERN.test(method) ||
    method === 'CONNECT' ||
    method === 'TRACE' ||
    method === 'TRACK'
  ) {
    throw invalidConfig();
  }
  return method;
}

function validateMethodBody(method: string, body: JsonValue | undefined): void {
  if ((method === 'GET' || method === 'HEAD') && body !== undefined) {
    throw invalidConfig();
  }
}

function parseTimeout(input: number): number {
  if (!Number.isInteger(input) || input < 1 || input > MAX_TIMEOUT_MS) {
    throw invalidConfig();
  }
  return input;
}

function parseHeaders(input: unknown): Readonly<Record<string, string>> {
  if (!isRecord(input)) throw invalidConfig();
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    const normalizedName = name.toLowerCase();
    if (
      !HTTP_TOKEN_PATTERN.test(name) ||
      typeof value !== 'string' ||
      headers[normalizedName] !== undefined
    ) {
      throw invalidConfig();
    }
    headers[normalizedName] = value;
  }
  return headers;
}

function mergeHeaders(
  base: Readonly<Record<string, string>>,
  partial?: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  return { ...base, ...partial };
}

function mergeBody(
  base: WebhookRequestConfig,
  partial: ParsedWebhookRequestPartial
): JsonValue | undefined {
  if (partial.body === undefined) {
    return base.body;
  }
  if (isJsonObject(base.body) && isJsonObject(partial.body)) {
    return { ...base.body, ...partial.body };
  }
  return partial.body;
}

function normalizeJsonBody(input: unknown): JsonValue {
  if (!isJsonValue(input)) throw invalidConfig();
  return input;
}
