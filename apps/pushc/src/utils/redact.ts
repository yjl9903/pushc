import { isRecord } from './value.js';

const REDACTION = '[REDACTED]';

export function redactForOutput<T>(input: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return input;
  return redactValue(input, secrets) as T;
}

function redactValue(input: unknown, secrets: readonly string[]): unknown {
  if (typeof input === 'string') {
    return secrets.reduce((value, secret) => value.replaceAll(secret, REDACTION), input);
  }
  if (typeof input === 'number' && Number.isFinite(input) && secrets.includes(String(input))) {
    return REDACTION;
  }
  if (Array.isArray(input)) {
    return input.map((value) => redactValue(value, secrets));
  }
  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, redactValue(value, secrets)])
    );
  }
  return input;
}
