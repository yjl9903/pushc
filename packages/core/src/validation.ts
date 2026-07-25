import { z } from 'zod';

import { PushError } from './error.js';
import type { PushPayload, PushSendOptions } from './types.js';

const PARAM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const PAYLOAD_FIELDS = new Set(['message', 'attachments', 'title', 'param']);
const SEND_OPTION_FIELDS = new Set(['signal', 'dryRun']);

const paramSchema = z.record(z.string().regex(PARAM_KEY_PATTERN), z.string());
const payloadSchema = z.strictObject({
  message: z.string(),
  attachments: z.array(z.string().refine((value) => value.trim().length > 0)).optional(),
  title: z.string().optional(),
  param: paramSchema.optional()
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
    if (
      result.data.message.trim().length === 0 &&
      (result.data.attachments === undefined || result.data.attachments.length === 0)
    ) {
      throw new PushError('INVALID_MESSAGE', 'Invalid push payload.');
    }

    const param =
      result.data.param === undefined
        ? undefined
        : Object.freeze(
            Object.assign(Object.create(null) as Record<string, string>, result.data.param)
          );
    const attachments =
      result.data.attachments === undefined || result.data.attachments.length === 0
        ? undefined
        : Object.freeze([...result.data.attachments]);

    return Object.freeze({
      message: result.data.message,
      ...(attachments === undefined ? {} : { attachments }),
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
    const options = input === undefined ? {} : input;
    if (!isRecord(options)) throw new Error('Send options must be an object.');
    assertAllowedFields(options, SEND_OPTION_FIELDS);

    const signal = options.signal;
    const dryRun = options.dryRun;
    if (signal !== undefined && !isAbortSignal(signal)) {
      throw new Error('signal must be an AbortSignal-compatible object.');
    }
    if (dryRun !== undefined && typeof dryRun !== 'boolean') {
      throw new Error('dryRun must be a boolean.');
    }

    return Object.freeze({
      ...(signal === undefined ? {} : { signal }),
      ...(dryRun === undefined ? {} : { dryRun })
    });
  } catch (cause) {
    throw new PushError('INVALID_SEND_OPTIONS', 'Invalid send options.', { cause });
  }
}

function isAbortSignal(input: unknown): input is AbortSignal {
  return (
    isRecord(input) &&
    typeof Reflect.get(input, 'aborted') === 'boolean' &&
    typeof Reflect.get(input, 'addEventListener') === 'function' &&
    typeof Reflect.get(input, 'removeEventListener') === 'function'
  );
}

function assertAllowedFields(input: unknown, allowed: ReadonlySet<string>): void {
  if (isRecord(input) && Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error('Object contains an unknown field.');
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
