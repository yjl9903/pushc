export type WebhookErrorCode = 'INVALID_CONFIG';

export class WebhookError extends Error {
  readonly code: WebhookErrorCode;

  constructor(code: WebhookErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'WebhookError';
    this.code = code;
  }
}
