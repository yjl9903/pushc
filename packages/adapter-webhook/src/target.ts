import type { PushPayload } from '@pushc/core';

import type { JsonValue } from './types.js';

const PARAM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const ASCII_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

export function renderWebhookTemplate(template: string, payload: PushPayload): string {
  let output = '';
  let cursor = 0;
  while (cursor < template.length) {
    const escapedStart = template.startsWith('\\{{', cursor);
    const start = escapedStart ? cursor + 1 : template.startsWith('{{', cursor) ? cursor : -1;
    if (start < 0) {
      output += template[cursor];
      cursor += 1;
      continue;
    }

    const end = template.indexOf('}}', start + 2);
    if (end < 0) {
      output += template.slice(cursor);
      break;
    }
    const source = template.slice(start, end + 2);
    if (escapedStart) {
      output += source;
    } else {
      const replacement = evaluateExpression(template.slice(start + 2, end), payload);
      output += replacement === undefined ? source : replacement;
    }
    cursor = end + 2;
  }
  return output;
}

export function renderWebhookBody(value: JsonValue, payload: PushPayload): JsonValue {
  if (typeof value === 'string') return renderWebhookTemplate(value, payload);
  if (Array.isArray(value)) return value.map((item) => renderWebhookBody(item, payload));
  if (value !== null && typeof value === 'object') {
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const [key, item] of Object.entries(value)) {
      result[key] = renderWebhookBody(item, payload);
    }
    return result;
  }
  return value;
}

function evaluateExpression(expression: string, payload: PushPayload): string | undefined {
  const trimmed = expression.replace(ASCII_WHITESPACE, '');
  const separator = trimmed.indexOf(':-');
  const variable = (separator < 0 ? trimmed : trimmed.slice(0, separator)).replace(
    ASCII_WHITESPACE,
    ''
  );
  const fallback = separator < 0 ? undefined : trimmed.slice(separator + 2);

  let value: string | undefined;
  if (variable === 'message') {
    value = payload.message;
  } else if (variable === 'title') {
    value = payload.title;
  } else if (variable.startsWith('param.')) {
    const key = variable.slice('param.'.length);
    if (!PARAM_KEY_PATTERN.test(key)) return undefined;
    value =
      payload.param !== undefined && Object.hasOwn(payload.param, key)
        ? payload.param[key]
        : undefined;
  } else {
    return undefined;
  }
  return value === undefined || value === '' ? (fallback ?? '') : value;
}
