import {
  renderTemplate,
  type NormalizedPushPayload,
  type PushAdapterOperationOptions,
  type PushDispatchResult
} from '@pushc/core';

import { invalidConfig, parseContentType } from './config.js';
import { WebhookError } from './error.js';
import { renderWebhookBody, webhookTemplateContext } from './template.js';
import type {
  JsonValue,
  WebhookRequestConfig,
  WebhookRequestReceipt,
  WebhookResponseConfig,
  WebhookResponseReceipt
} from './types.js';
import { isJsonValue } from './utils/json.js';
import { getWebhookResponseFailure } from './response.js';

export interface WebhookDispatchPlan {
  readonly request: WebhookRequestReceipt;
  readonly responsePolicy: WebhookResponseConfig;
}

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
  payload: NormalizedPushPayload
): WebhookRequestReceipt {
  try {
    const templateContext = webhookTemplateContext(payload);
    const url = parseFinalUrl(renderTemplate(target.url, templateContext), origin);

    const headers = new Headers(
      Object.entries(target.headers).map(([name, value]) => [
        name,
        renderTemplate(value, templateContext)
      ])
    );

    const body =
      target.body === undefined ? undefined : renderWebhookBody(target.body, templateContext);
    if (body !== undefined) {
      const configured = parseContentType(target.content_type ?? 'application/json');
      const explicitHeader = headers.get('content-type');
      if (explicitHeader === null) {
        headers.set('content-type', configured.value);
      } else if (parseContentType(explicitHeader).essence !== configured.essence) {
        throw invalidConfig();
      }
      if (configured.essence === 'text/plain' && typeof body !== 'string') throw invalidConfig();
    }

    if ((target.method === 'GET' || target.method === 'HEAD') && body !== undefined) {
      throw invalidConfig();
    }

    return {
      url,
      method: target.method,
      headers: Object.fromEntries(headers),
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
  plan: WebhookDispatchPlan,
  options: PushAdapterOperationOptions
): Promise<PushDispatchResult<never, WebhookResponseReceipt>> {
  const { request, responsePolicy } = plan;
  const timeoutSignal = AbortSignal.timeout(request.timeout_ms);
  const signal =
    options.signal === undefined ? timeoutSignal : AbortSignal.any([options.signal, timeoutSignal]);
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
      signal
    });

    const responseReceipt = await readResponse(response);
    const responseFailure = getWebhookResponseFailure(responsePolicy, responseReceipt);

    if (responseFailure !== undefined) {
      return failure(responseFailure, responseReceipt);
    }
    return {
      success: true,
      summary: `Webhook ${request.method} to ${new URL(request.url).host} completed with HTTP ${response.status}.`,
      response: responseReceipt
    };
  } catch (error) {
    if (signal.aborted) {
      return failure(
        timeoutSignal.aborted && signal.reason === timeoutSignal.reason
          ? `Webhook request timed out after ${request.timeout_ms}ms.`
          : 'Webhook request was aborted.'
      );
    }
    return failure(error instanceof WebhookError ? error.message : 'Webhook request failed.');
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
  const headers = Object.fromEntries(
    [...response.headers].filter(([name]) => !FILTERED_RESPONSE_HEADERS.has(name))
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
}
