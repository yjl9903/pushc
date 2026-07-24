import type { PushPayload, PushSendOptions } from '@pushc/core';

import { invalidConfig, parseContentType } from './config.js';
import { WebhookError } from './error.js';
import { renderWebhookBody, renderWebhookTemplate } from './target.js';
import type { WebhookReceipt, WebhookRequest, WebhookRequestConfig } from './types.js';

export function buildWebhookRequest(
  target: WebhookRequestConfig,
  origin: string,
  payload: PushPayload
): WebhookRequest {
  try {
    const url = parseFinalUrl(renderWebhookTemplate(target.url, payload), origin);
    const headerMap = new Map<string, string>();
    for (const [name, value] of Object.entries(target.headers)) {
      headerMap.set(name, renderWebhookTemplate(value, payload));
    }

    const renderedBody =
      target.body === undefined ? undefined : renderWebhookBody(target.body, payload);
    let body: string | undefined;
    if (renderedBody !== undefined) {
      const configured = parseContentType(target.content_type ?? 'application/json');
      const explicitHeader = headerMap.get('content-type');
      if (explicitHeader === undefined) {
        headerMap.set('content-type', configured.value);
      } else if (parseContentType(explicitHeader).essence !== configured.essence) {
        throw invalidConfig();
      }
      if (configured.essence === 'text/plain') {
        if (typeof renderedBody !== 'string') throw invalidConfig();
        body = renderedBody;
      } else {
        try {
          body = JSON.stringify(renderedBody);
        } catch (cause) {
          throw invalidConfig(cause);
        }
      }
    }
    if ((target.method === 'GET' || target.method === 'HEAD') && renderedBody !== undefined) {
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
      headers,
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
  request: WebhookRequest,
  options: Readonly<PushSendOptions>
): Promise<WebhookReceipt> {
  if (typeof fetch !== 'function') {
    throw new WebhookError('FETCH_UNAVAILABLE', 'This runtime does not provide fetch.');
  }

  const requestAbort = requestSignal(options.signal, request.timeout_ms);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: requestAbort.signal
    });
    if (!response.ok) {
      throw new WebhookError(
        'HTTP_ERROR',
        `Webhook returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
        { status: response.status }
      );
    }
    return { status: response.status };
  } catch (error) {
    if (error instanceof WebhookError) throw error;
    if (requestAbort.signal.aborted) {
      throw new WebhookError(
        'ABORTED',
        requestAbort.signal.reason === timeoutReason
          ? `Webhook request timed out after ${request.timeout_ms}ms.`
          : 'Webhook request was aborted.',
        { cause: error }
      );
    }
    throw error;
  } finally {
    requestAbort.cleanup();
  }
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
