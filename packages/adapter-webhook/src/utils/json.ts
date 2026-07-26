import type { JsonValue } from '../types.js';
import { isRecord } from './record.js';

export function isJsonValue(input: unknown): input is JsonValue {
  if (
    input === null ||
    typeof input === 'string' ||
    typeof input === 'boolean' ||
    (typeof input === 'number' && Number.isFinite(input))
  ) {
    return true;
  }
  if (Array.isArray(input)) return input.every(isJsonValue);
  if (!isRecord(input)) return false;
  return Object.values(input).every(isJsonValue);
}

export function isJsonObject(input: unknown): input is { readonly [key: string]: JsonValue } {
  return isRecord(input);
}
