import type { PushAdapterOperationOptions, PushDispatchResult, PushPayload } from '@pushc/core';

import { invalidConfig, parseContentType } from './config.js';
import { WebhookError } from './error.js';
import { renderWebhookBody, renderWebhookTemplate } from './target.js';
import type {
  JsonValue,
  WebhookRequestConfig,
  WebhookRequestReceipt,
  WebhookResponseReceipt
} from './types.js';
import { isJsonValue } from './utils/json.js';

const FILTERED_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'set-cookie2',
  'www-authenticate',
  'proxy-authenticate',
  'authentication-info',
  'proxy-authentication-info'
]);

export function buildWebhookRequest(
  target: WebhookRequestConfig,
  origin: string,
  payload: PushPayload
): WebhookRequestReceipt {
  try {
    const url = parseFinalUrl(renderWebhookTemplate(target.url, payload), origin);
    const headerMap = new Map<string, string>();
    for (const [name, value] of Object.entries(target.headers)) {
      headerMap.set(name, renderWebhookTemplate(value, payload));
    }

    const body = target.body === undefined ? undefined : renderWebhookBody(target.body, payload);
    if (body !== undefined) {
      const configured = parseContentType(target.content_type ?? 'application/json');
      const explicitHeader = headerMap.get('content-type');
      if (explicitHeader === undefined) {
        headerMap.set('content-type', configured.value);
      } else if (parseContentType(explicitHeader).essence !== configured.essence) {
        throw invalidConfig();
      }
      if (configured.essence === 'text/plain') {
        if (typeof body !== 'string') throw invalidConfig();
      } else {
        try {
          JSON.stringify(body);
        } catch (cause) {
          throw invalidConfig(cause);
        }
      }
    }
    if ((target.method === 'GET' || target.method === 'HEAD') && body !== undefined) {
      throw invalidConfig();
    }

    let headers: Headers;
    try {
      headers = new Headers([...headerMap]);
    } catch (cause) {
      throw invalidConfig(cause);
    }
    return {
      url,
      method: target.method,
      headers: Object.freeze(Object.fromEntries(headers)),
      ...(target.content_type === undefined ? {} : { content_type: target.content_type }),
      timeout_ms: target.timeout_ms,
      ...(body === undefined ? {} : { body })
    };
  } catch (cause) {
    if (cause instanceof WebhookError) throw cause;
    throw invalidConfig(cause);
  }
}

export async function sendWebhook(
  fetch: typeof globalThis.fetch,
  request: WebhookRequestReceipt,
  options: PushAdapterOperationOptions
): Promise<PushDispatchResult<never, WebhookResponseReceipt>> {
  if (typeof fetch !== 'function') {
    return failure('This runtime does not provide fetch.');
  }

  const requestAbort = requestSignal(options.signal, request.timeout_ms);
  try {
    const contentType =
      request.content_type === undefined ? undefined : parseContentType(request.content_type);
    const body =
      request.body === undefined
        ? undefined
        : contentType?.essence === 'text/plain'
          ? (request.body as string)
          : JSON.stringify(request.body);
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(body === undefined ? {} : { body }),
      signal: requestAbort.signal
    });
    const responseReceipt = await readResponse(response);
    if (!response.ok) {
      return failure(`Webhook returned HTTP ${response.status}.`, responseReceipt);
    }
    return {
      success: true,
      summary: `Webhook ${request.method} to ${new URL(request.url).host} completed with HTTP ${response.status}.`,
      response: responseReceipt
    };
  } catch (error) {
    if (requestAbort.signal.aborted) {
      return failure(
        requestAbort.signal.reason === timeoutReason
          ? `Webhook request timed out after ${request.timeout_ms}ms.`
          : 'Webhook request was aborted.'
      );
    }
    return failure(error instanceof WebhookError ? error.message : 'Webhook request failed.');
  } finally {
    requestAbort.cleanup();
  }
}

function failure(
  message: string,
  response?: WebhookResponseReceipt
): PushDispatchResult<never, WebhookResponseReceipt> {
  return {
    success: false,
    ...(response === undefined ? {} : { response }),
    error: { code: 'SEND_FAILED', message }
  };
}

async function readResponse(response: Response): Promise<WebhookResponseReceipt> {
  const headers = Object.freeze(
    Object.fromEntries(
      [...response.headers].filter(([name]) => !FILTERED_RESPONSE_HEADERS.has(name.toLowerCase()))
    )
  );
  let body: JsonValue | undefined;
  try {
    const text = await response.text();
    if (text !== '') {
      const parsed: unknown = JSON.parse(text);
      if (isJsonValue(parsed)) body = parsed;
    }
  } catch {
    // Response parsing is best effort and does not change send success.
  }
  return {
    status: response.status,
    headers,
    ...(body === undefined ? {} : { body })
  };
}

function parseFinalUrl(input: string, origin: string): string {
  try {
    const url = new URL(input);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== '' ||
      url.origin !== origin
    ) {
      throw invalidConfig();
    }
    return url.toString();
  } catch (cause) {
    if (cause instanceof WebhookError) throw cause;
    throw invalidConfig(cause);
  }
}

const timeoutReason = Symbol('timeout');

function requestSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutReason), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abortFromParent);
    }
  };
}
