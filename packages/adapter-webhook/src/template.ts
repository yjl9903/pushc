import { renderTemplate, type NormalizedPushPayload, type TemplateContext } from '@pushc/core';

import type { JsonValue } from './types.js';

export function webhookTemplateContext(payload: NormalizedPushPayload): TemplateContext {
  return {
    variables: new Map([
      [
        'message',
        payload.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('')
      ],
      ['title', payload.title]
    ]),
    namespaces: new Map([['param', payload.param]])
  };
}

export function renderWebhookBody(value: JsonValue, context: TemplateContext): JsonValue {
  if (typeof value === 'string') return renderTemplate(value, context);
  if (Array.isArray(value)) return value.map((item) => renderWebhookBody(item, context));
  if (value !== null && typeof value === 'object') {
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const [key, item] of Object.entries(value)) {
      result[key] = renderWebhookBody(item, context);
    }
    return result;
  }
  return value;
}
