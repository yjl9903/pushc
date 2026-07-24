import { z } from 'zod';

import { PushError } from './error.js';
import type { PushPayload, PushSendOptions } from './types.js';

const PARAM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const PAYLOAD_FIELDS = new Set(['message', 'title', 'param']);
const SEND_OPTION_FIELDS = new Set(['signal']);

const signalSchema = z.custom<AbortSignal>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'aborted') === 'boolean' &&
    typeof Reflect.get(value, 'addEventListener') === 'function' &&
    typeof Reflect.get(value, 'removeEventListener') === 'function',
  'signal must be an AbortSignal-compatible object'
);

const paramSchema = z.record(z.string().regex(PARAM_KEY_PATTERN), z.string());
const payloadSchema = z.strictObject({
  message: z.string().refine((value) => value.trim().length > 0),
  title: z.string().optional(),
  param: paramSchema.optional()
});
const optionsSchema = z.strictObject({
  signal: signalSchema.optional()
});

export function normalizePayload(input: unknown): PushPayload {
  try {
    assertAllowedFields(input, PAYLOAD_FIELDS);
    if (
      isRecord(input) &&
      isRecord(input.param) &&
      Object.keys(input.param).some((key) => !PARAM_KEY_PATTERN.test(key))
    ) {
      throw new PushError('INVALID_MESSAGE', 'Invalid push payload.');
    }
    const result = payloadSchema.safeParse(input);
    if (!result.success) {
      throw new PushError('INVALID_MESSAGE', 'Invalid push payload.', {
        cause: result.error
      });
    }
    const param =
      result.data.param === undefined
        ? undefined
        : Object.freeze(
            Object.assign(Object.create(null) as Record<string, string>, result.data.param)
          );
    return Object.freeze({
      message: result.data.message,
      ...(result.data.title === undefined ? {} : { title: result.data.title }),
      ...(param === undefined ? {} : { param })
    });
  } catch (cause) {
    if (cause instanceof PushError) throw cause;
    throw new PushError('INVALID_MESSAGE', 'Invalid push payload.', { cause });
  }
}

export function normalizeSendOptions(input: unknown): Readonly<PushSendOptions> {
  try {
    const normalizedInput = input === undefined ? {} : input;
    assertAllowedFields(normalizedInput, SEND_OPTION_FIELDS);
    const result = optionsSchema.safeParse(normalizedInput);
    if (!result.success) {
      throw new PushError('INVALID_SEND_OPTIONS', 'Invalid send options.', {
        cause: result.error
      });
    }
    return Object.freeze(result.data.signal === undefined ? {} : { signal: result.data.signal });
  } catch (cause) {
    if (cause instanceof PushError) throw cause;
    throw new PushError('INVALID_SEND_OPTIONS', 'Invalid send options.', { cause });
  }
}

function assertAllowedFields(input: unknown, allowed: ReadonlySet<string>): void {
  if (isRecord(input) && Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error('Object contains an unknown field.');
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
