import type { PushPayload } from '@pushc/core';

import { CliUsageError } from '../error.js';

const PARAM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function parseParamEntries(
  entries: readonly string[] | undefined
): Readonly<Record<string, string>> | undefined {
  if (!entries || entries.length === 0) return undefined;

  const params = Object.create(null) as Record<string, string>;
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    const key = separator < 0 ? '' : entry.slice(0, separator);
    if (separator < 0 || !PARAM_KEY_PATTERN.test(key)) {
      throw new CliUsageError(
        '--param entries must use key=value with keys containing only letters, digits, _, . or -.'
      );
    }
    if (Object.hasOwn(params, key)) {
      throw new CliUsageError(`Duplicate --param key "${key}".`);
    }
    params[key] = entry.slice(separator + 1);
  }
  return params;
}

export function applyParamOverrides(
  payload: PushPayload,
  overrides: Readonly<Record<string, string>> | undefined
): PushPayload {
  if (overrides === undefined) return payload;
  if (payload.param == null) return { ...payload, param: overrides };
  if (!isPlainRecord(payload.param)) return payload;

  return {
    ...payload,
    param: Object.assign(Object.create(null) as Record<string, string>, payload.param, overrides)
  };
}

function isPlainRecord(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
