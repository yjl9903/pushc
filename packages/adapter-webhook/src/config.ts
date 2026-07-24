import { z } from 'zod';

import { WebhookError } from './error.js';
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
const CONFIG_FIELDS = new Set(['url', 'request', 'response']);
const TARGET_FIELDS = new Set(['request', 'response']);
const REQUEST_FIELDS = new Set(['url', 'method', 'headers', 'content_type', 'timeout_ms', 'body']);

const requestSchema = z.strictObject({
  url: z.string().optional(),
  method: z.string().optional(),
  headers: z.unknown().optional(),
  content_type: z.string().optional(),
  timeout_ms: z.union([z.number(), z.bigint()]).optional(),
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
    if (!isRecord(input)) throw invalidConfig();
    assertAllowedFields(input, CONFIG_FIELDS);
    const result = configSchema.safeParse(input);
    if (!result.success) throw invalidConfig(result.error);
    if (
      (Object.hasOwn(input, 'request') && input.request === undefined) ||
      (Object.hasOwn(input, 'response') && input.response === undefined)
    ) {
      throw invalidConfig();
    }

    const url = parseAdapterUrl(result.data.url);
    const request = resolveWebhookRequest(
      {
        url,
        method: 'POST',
        headers: emptyRecord(),
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
  try {
    if (!isRecord(input)) throw invalidConfig();
    assertAllowedFields(input, TARGET_FIELDS);
    const result = targetSchema.safeParse(input);
    if (!result.success) throw invalidConfig(result.error);
    if (
      (Object.hasOwn(input, 'request') && input.request === undefined) ||
      (Object.hasOwn(input, 'response') && input.response === undefined)
    ) {
      throw invalidConfig();
    }
    return {
      ...(result.data.request === undefined
        ? {}
        : { request: parseWebhookRequestInput(result.data.request) }),
      ...(result.data.response === undefined
        ? {}
        : { response: parseWebhookResponse(result.data.response) })
    };
  } catch (cause) {
    if (cause instanceof WebhookError) throw cause;
    throw invalidConfig(cause);
  }
}

export function resolveWebhookTarget(
  base: WebhookConfig,
  partial: ParsedWebhookTargetPartial
): WebhookTargetConfig {
  try {
    return {
      request: resolveWebhookRequest(base.request, partial.request ?? {}),
      response: {}
    };
  } catch (cause) {
    if (cause instanceof WebhookError) throw cause;
    throw invalidConfig(cause);
  }
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
  try {
    if (!isRecord(input)) throw invalidConfig();
    assertAllowedFields(input, REQUEST_FIELDS);
    const result = requestSchema.safeParse(input);
    if (!result.success) throw invalidConfig(result.error);
    if (Object.hasOwn(input, 'body') && input.body === undefined) {
      throw invalidConfig();
    }
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
      ...(Object.hasOwn(input, 'body') ? { body: normalizeJsonBody(input.body) } : {})
    };
  } catch (cause) {
    if (cause instanceof WebhookError) throw cause;
    throw invalidConfig(cause);
  }
}

function parseWebhookResponse(input: unknown): WebhookResponseConfig {
  if (!isRecord(input)) throw invalidConfig();
  const prototype = Object.getPrototypeOf(input);
  if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(input).length > 0) {
    throw invalidConfig();
  }
  return {};
}

function resolveWebhookRequest(
  base: WebhookRequestConfig,
  partial: ParsedWebhookRequestPartial
): WebhookRequestConfig {
  const body = mergeBody(base, partial);
  const contentType = Object.hasOwn(partial, 'content_type')
    ? partial.content_type
    : base.content_type;
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
  try {
    const url = new URL(input);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw invalidConfig();
    }
    return url.toString();
  } catch (cause) {
    if (cause instanceof WebhookError) throw cause;
    throw invalidConfig(cause);
  }
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

function parseTimeout(input: number | bigint): number {
  const value = typeof input === 'bigint' ? Number(input) : input;
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_TIMEOUT_MS ||
    (typeof input === 'bigint' && BigInt(value) !== input)
  ) {
    throw invalidConfig();
  }
  return value;
}

function parseHeaders(input: unknown): Readonly<Record<string, string>> {
  if (!isRecord(input)) throw invalidConfig();
  const headers = new Map<string, string>();
  for (const [name, value] of Object.entries(input)) {
    const normalizedName = name.toLowerCase();
    if (
      !HTTP_TOKEN_PATTERN.test(name) ||
      typeof value !== 'string' ||
      headers.has(normalizedName)
    ) {
      throw invalidConfig();
    }
    headers.set(normalizedName, value);
  }
  return recordFromMap(headers);
}

function mergeHeaders(
  base: Readonly<Record<string, string>>,
  partial?: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  const headers = new Map(Object.entries(base));
  for (const entry of Object.entries(partial ?? {})) headers.set(...entry);
  return recordFromMap(headers);
}

function mergeBody(
  base: WebhookRequestConfig,
  partial: ParsedWebhookRequestPartial
): JsonValue | undefined {
  if (!Object.hasOwn(partial, 'body')) {
    return base.body === undefined ? undefined : cloneJson(base.body);
  }
  if (isJsonObject(base.body) && isJsonObject(partial.body)) {
    const values = new Map<string, JsonValue>(Object.entries(base.body));
    for (const entry of Object.entries(partial.body)) values.set(...entry);
    return jsonObjectFromMap(values);
  }
  return partial.body === undefined ? undefined : cloneJson(partial.body);
}

function normalizeJsonBody(input: unknown): JsonValue {
  try {
    const serialized = JSON.stringify(input, (_key, value: unknown) => {
      if (typeof value === 'bigint') {
        if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw invalidConfig();
        }
        return Number(value);
      }
      if (
        value === undefined ||
        typeof value === 'symbol' ||
        typeof value === 'function' ||
        (typeof value === 'number' && !Number.isFinite(value))
      ) {
        throw invalidConfig();
      }
      return value;
    });
    if (serialized === undefined) throw invalidConfig();
    return toNullPrototypeJson(JSON.parse(serialized) as JsonValue);
  } catch (cause) {
    if (cause instanceof WebhookError) throw cause;
    throw invalidConfig(cause);
  }
}

function cloneJson(input: JsonValue): JsonValue {
  if (Array.isArray(input)) return input.map(cloneJson);
  if (isJsonObject(input)) {
    return jsonObjectFromMap(
      new Map(Object.entries(input).map(([key, value]) => [key, cloneJson(value)]))
    );
  }
  return input;
}

function toNullPrototypeJson(input: JsonValue): JsonValue {
  if (Array.isArray(input)) return input.map(toNullPrototypeJson);
  if (isJsonObject(input)) {
    return jsonObjectFromMap(
      new Map(Object.entries(input).map(([key, value]) => [key, toNullPrototypeJson(value)]))
    );
  }
  return input;
}

function isJsonObject(input: unknown): input is { readonly [key: string]: JsonValue } {
  return isRecord(input);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function assertAllowedFields(
  input: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>
): void {
  if (Object.keys(input).some((key) => !allowed.has(key))) throw invalidConfig();
}

function emptyRecord(): Readonly<Record<string, string>> {
  return Object.create(null) as Record<string, string>;
}

function recordFromMap(values: ReadonlyMap<string, string>): Readonly<Record<string, string>> {
  return Object.assign(Object.create(null) as Record<string, string>, Object.fromEntries(values));
}

function jsonObjectFromMap(values: ReadonlyMap<string, JsonValue>): {
  readonly [key: string]: JsonValue;
} {
  const result = Object.create(null) as Record<string, JsonValue>;
  for (const [key, value] of values) result[key] = value;
  return result;
}
