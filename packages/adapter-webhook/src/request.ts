import { WebhookError } from './error.js';
import { renderWebhookBody } from './target.js';
import type { WebhookConfig, WebhookReceipt, WebhookTargetConfig } from './types.js';

export async function sendWebhook(
  fetch: typeof globalThis.fetch,
  config: WebhookConfig,
  target: WebhookTargetConfig,
  message: string,
  parentSignal?: AbortSignal
): Promise<WebhookReceipt> {
  if (typeof fetch !== 'function') {
    throw new WebhookError('FETCH_UNAVAILABLE', 'This runtime does not provide fetch.');
  }

  const request = requestSignal(parentSignal, config.timeout_ms);
  const headers = new Headers(config.headers);
  const transformed = renderWebhookBody(target.body, message);
  const body = target.body_mode === 'json' ? JSON.stringify(transformed) : String(transformed);
  if (!headers.has('content-type')) {
    headers.set(
      'content-type',
      target.body_mode === 'json' ? 'application/json' : 'text/plain; charset=utf-8'
    );
  }

  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers,
      body,
      signal: request.signal
    });
    if (!response.ok) {
      throw new WebhookError(
        'HTTP_ERROR',
        `Webhook returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
        { status: response.status }
      );
    }
    return { status: response.status, statusText: response.statusText };
  } catch (error) {
    if (error instanceof WebhookError) throw error;
    if (request.signal.aborted) {
      throw new WebhookError(
        'ABORTED',
        request.signal.reason === timeoutReason
          ? `Webhook request timed out after ${config.timeout_ms}ms.`
          : 'Webhook request was aborted.'
      );
    }
    throw error;
  } finally {
    request.cleanup();
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
