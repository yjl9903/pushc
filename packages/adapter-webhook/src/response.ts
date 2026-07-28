import type {
  JsonValue,
  WebhookBodyAssertion,
  WebhookHeaderAssertion,
  WebhookResponseConfig,
  WebhookResponseReceipt,
  WebhookResponseStatus
} from './types.js';
import { isJsonObject } from './utils/json.js';

export function getWebhookResponseFailure(
  config: WebhookResponseConfig,
  response: WebhookResponseReceipt
): string | undefined {
  if (!matchesStatus(config.status, response.status)) {
    return `Webhook returned HTTP ${response.status}.`;
  }

  for (const [path, assertion] of Object.entries(config.body)) {
    const value = resolveBodyPointer(response, path);
    if (!matchesBodyAssertion(assertion, value)) {
      return `Webhook response body assertion failed at "${path}".`;
    }
  }

  for (const [name, assertion] of Object.entries(config.headers)) {
    const exists = Object.hasOwn(response.headers, name);
    if (!matchesHeaderAssertion(assertion, exists, response.headers[name])) {
      return `Webhook response header assertion failed for "${name}".`;
    }
  }

  return undefined;
}

function matchesStatus(expected: WebhookResponseStatus, actual: number): boolean {
  return expected === '2xx' ? actual >= 200 && actual <= 299 : expected.includes(actual);
}

function resolveBodyPointer(
  response: WebhookResponseReceipt,
  pointer: string
): JsonValue | undefined {
  if (!Object.hasOwn(response, 'body')) return undefined;
  let value = response.body!;
  if (pointer === '') return value;

  for (const encodedToken of pointer.slice(1).split('/')) {
    const token = encodedToken.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) return undefined;
      const index = Number(token);
      if (index >= value.length) return undefined;
      value = value[index]!;
    } else if (isJsonObject(value) && Object.hasOwn(value, token)) {
      value = value[token]!;
    } else {
      return undefined;
    }
  }

  return value;
}

function matchesBodyAssertion(
  assertion: WebhookBodyAssertion,
  value: JsonValue | undefined
): boolean {
  if ('exists' in assertion) return assertion.exists === (value !== undefined);
  return value !== undefined && jsonEquals(assertion.equals, value);
}

function matchesHeaderAssertion(
  assertion: WebhookHeaderAssertion,
  exists: boolean,
  value: string | undefined
): boolean {
  if ('exists' in assertion) return assertion.exists === exists;
  return exists && assertion.equals === value;
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEquals(value, right[index]!))
    );
  }
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && jsonEquals(left[key]!, right[key]!))
  );
}
