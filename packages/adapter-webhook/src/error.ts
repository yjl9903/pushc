export type WebhookErrorCode = 'INVALID_CONFIG' | 'FETCH_UNAVAILABLE' | 'HTTP_ERROR' | 'ABORTED';

export class WebhookError extends Error {
  readonly code: WebhookErrorCode;
  readonly status?: number;

  constructor(code: WebhookErrorCode, message: string, options: { status?: number } = {}) {
    super(message);
    this.name = 'WebhookError';
    this.code = code;
    this.status = options.status;
  }
}
