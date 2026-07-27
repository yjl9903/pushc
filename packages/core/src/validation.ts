import { z } from 'zod';

import { normalizeContent } from './content.js';
import { PushError } from './error.js';
import type { NormalizedPushPayload, PushSendOptions } from './types.js';

const PARAM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const paramSchema = z.map(z.string().regex(PARAM_KEY_PATTERN), z.string());
const payloadSchema = z.strictObject({
  content: z.unknown(),
  attachments: z.unknown().optional(),
  title: z.string().optional(),
  param: paramSchema.optional()
});
const sendOptionsSchema = z.strictObject({
  signal: z.instanceof(AbortSignal).optional(),
  dryRun: z.boolean().optional(),
  basePath: z.string().min(1).optional()
});

export function normalizePayload(input: unknown): NormalizedPushPayload {
  const result = payloadSchema.safeParse(input);
  if (!result.success) throw invalidPayload(result.error);

  const param = result.data.param === undefined ? undefined : new Map(result.data.param);
  const hasAttachments = result.data.attachments !== undefined;
  const content = normalizeContent(result.data.content, result.data.attachments, hasAttachments, {
    variables: new Map([['title', result.data.title]]),
    namespaces: new Map([['param', param]])
  });

  return {
    content,
    ...(result.data.title === undefined ? {} : { title: result.data.title }),
    ...(param === undefined ? {} : { param })
  };
}

function invalidPayload(cause?: unknown): PushError {
  return new PushError('INVALID_MESSAGE', 'Invalid push payload.', { cause });
}

export function normalizeSendOptions(input: unknown): Readonly<PushSendOptions> {
  const result = sendOptionsSchema.safeParse(input === undefined ? {} : input);
  if (!result.success) {
    throw new PushError('INVALID_SEND_OPTIONS', 'Invalid send options.', {
      cause: result.error
    });
  }
  return result.data;
}
