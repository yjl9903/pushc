import { z } from 'zod';

import { normalizeContent } from './content.js';
import { PushError } from './error.js';
import type { NormalizedPushPayload, PushSendOptions } from './types.js';

const PARAM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const PAYLOAD_FIELDS = new Set(['content', 'attachments', 'title', 'param']);
const SEND_OPTION_FIELDS = new Set(['signal', 'dryRun']);

const paramSchema = z.record(z.string().regex(PARAM_KEY_PATTERN), z.string());
const metadataSchema = z.strictObject({
  title: z.string().optional(),
  param: paramSchema.nullish()
});

export function normalizePayload(input: unknown): NormalizedPushPayload {
  try {
    if (!isRecord(input)) throw invalidPayload();
    assertAllowedFields(input, PAYLOAD_FIELDS);
    if (
      isRecord(input.param) &&
      Object.keys(input.param).some((key) => !PARAM_KEY_PATTERN.test(key))
    ) {
      throw invalidPayload();
    }

    const metadata = metadataSchema.safeParse({
      ...(Object.hasOwn(input, 'title') ? { title: input.title } : {}),
      ...(Object.hasOwn(input, 'param') ? { param: input.param } : {})
    });
    if (!metadata.success) throw invalidPayload(metadata.error);

    const param =
      metadata.data.param == null
        ? undefined
        : Object.freeze(
            Object.assign(Object.create(null) as Record<string, string>, metadata.data.param)
          );

    const hasAttachments = input.attachments !== undefined;
    const content = normalizeContent(input.content, input.attachments, hasAttachments);

    return Object.freeze({
      content,
      ...(metadata.data.title === undefined ? {} : { title: metadata.data.title }),
      ...(param === undefined ? {} : { param })
    });
  } catch (cause) {
    if (cause instanceof PushError) throw cause;
    throw new PushError('INVALID_MESSAGE', 'Invalid push payload.', { cause });
  }
}

function invalidPayload(cause?: unknown): PushError {
  return new PushError('INVALID_MESSAGE', 'Invalid push payload.', { cause });
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
