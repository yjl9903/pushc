import type { JsonValue } from '../types.js';
import { isRecord, recordFromMap } from './record.js';

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
  const prototype = Object.getPrototypeOf(input);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(input).every(isJsonValue)
  );
}

export function isJsonObject(input: unknown): input is { readonly [key: string]: JsonValue } {
  return isRecord(input);
}

export function cloneJson(input: JsonValue): JsonValue {
  if (Array.isArray(input)) return input.map(cloneJson);
  if (isJsonObject(input)) {
    return recordFromMap(
      new Map(Object.entries(input).map(([key, value]) => [key, cloneJson(value)]))
    );
  }
  return input;
}

export function toNullPrototypeJson(input: JsonValue): JsonValue {
  if (Array.isArray(input)) return input.map(toNullPrototypeJson);
  if (isJsonObject(input)) {
    return recordFromMap(
      new Map(Object.entries(input).map(([key, value]) => [key, toNullPrototypeJson(value)]))
    );
  }
  return input;
}
