export type WebhookErrorCode = 'INVALID_CONFIG';

export class WebhookError extends Error {
  readonly code: WebhookErrorCode;
  override readonly cause?: unknown;

  constructor(code: WebhookErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WebhookError';
    this.code = code;
    if (Object.hasOwn(options, 'cause')) {
      this.cause = options.cause;
    }
  }
}
