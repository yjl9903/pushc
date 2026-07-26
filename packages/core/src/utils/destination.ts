import { z } from 'zod';

import type { PushDestination, PushTargetInput } from '../types.js';

import { PushError } from '../error.js';

const DESTINATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const targetRecordSchema = z.record(z.string(), z.unknown());
const targetSchema = z.union([z.string().regex(DESTINATION_NAME_PATTERN), targetRecordSchema]);
const destinationSchema = z.strictObject({
  adapter: z.string().regex(DESTINATION_NAME_PATTERN),
  target: targetSchema.optional()
});

export interface NormalizedDestination {
  readonly adapter: string;
  readonly target?: PushTargetInput;
}

export function isDestinationName(input: unknown): input is string {
  return typeof input === 'string' && DESTINATION_NAME_PATTERN.test(input);
}

export function validateDestinationName(name: string, label: string): void {
  if (!isDestinationName(name)) {
    throw new PushError(
      'INVALID_CONFIG',
      `${label} names must start with a letter or digit and use only letters, digits, _ or -.`
    );
  }
}

export function formatDestination(adapter: string, target?: string): string {
  return target === undefined ? adapter : `${adapter}:${target}`;
}

export function normalizeDestination(input: PushDestination): NormalizedDestination {
  if (typeof input === 'string') {
    const parts = input.split(':');
    if (
      parts.length > 2 ||
      !isDestinationName(parts[0]) ||
      (parts.length === 2 && !isDestinationName(parts[1]))
    ) {
      throw new PushError(
        'INVALID_TARGET',
        'Destinations must be an adapter name or adapter:target using only letters, digits, _ or -.'
      );
    }
    return {
      adapter: parts[0],
      ...(parts[1] === undefined ? {} : { target: parts[1] })
    };
  }

  const result = destinationSchema.safeParse(input);
  if (!result.success) {
    throw new PushError('INVALID_TARGET', 'Invalid push destination.', {
      cause: result.error
    });
  }
  return {
    adapter: result.data.adapter,
    ...(result.data.target === undefined ? {} : { target: result.data.target })
  };
}
