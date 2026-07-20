import { isPushName, PushError } from '@pushc/core';

export interface TargetAddress {
  adapter: string;
  target?: string;
}

export function parseTargetAddress(input: unknown): TargetAddress {
  if (typeof input !== 'string') {
    throw new PushError('INVALID_TARGET', 'The --target option is required.');
  }
  const parts = input.split(':');
  if (parts.length > 2 || !isPushName(parts[0]) || (parts.length === 2 && !isPushName(parts[1]))) {
    throw new PushError(
      'INVALID_TARGET',
      'Target addresses must be an adapter name or adapter:target using only letters, digits, _ or -.'
    );
  }
  const adapter = parts[0];
  const target = parts[1];
  return {
    adapter,
    ...(target === undefined ? {} : { target })
  };
}

export function formatTargetAddress(adapter: string, target?: string): string {
  return target === undefined ? adapter : `${adapter}:${target}`;
}
