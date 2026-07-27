import type { PushPayload } from '@pushc/core';

import { CliUsageError } from '../error.js';

const PARAM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function parseParamEntries(
  entries: readonly string[] | undefined
): ReadonlyMap<string, string> | undefined {
  if (!entries || entries.length === 0) return undefined;

  const params = new Map<string, string>();
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    const key = separator < 0 ? '' : entry.slice(0, separator);
    if (separator < 0 || !PARAM_KEY_PATTERN.test(key)) {
      throw new CliUsageError(
        '--param entries must use key=value with keys containing only letters, digits, _, . or -.'
      );
    }
    if (params.has(key)) {
      throw new CliUsageError(`Duplicate --param key "${key}".`);
    }
    params.set(key, entry.slice(separator + 1));
  }
  return params;
}

export function applyParamOverrides(
  payload: PushPayload,
  overrides: ReadonlyMap<string, string> | undefined
): PushPayload {
  if (overrides === undefined) return payload;
  if (payload.param !== undefined && !(payload.param instanceof Map)) return payload;
  return {
    ...payload,
    param: new Map([...(payload.param ?? []), ...overrides])
  };
}
