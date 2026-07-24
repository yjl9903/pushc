export type WebhookErrorCode = 'INVALID_CONFIG' | 'FETCH_UNAVAILABLE' | 'HTTP_ERROR' | 'ABORTED';

export class WebhookError extends Error {
  readonly code: WebhookErrorCode;
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(
    code: WebhookErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WebhookError';
    this.code = code;
    this.status = options.status;
    if (Object.hasOwn(options, 'cause')) {
      this.cause = options.cause;
    }
  }
}
