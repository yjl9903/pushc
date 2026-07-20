export type PushErrorCode =
  | 'DUPLICATE_ADAPTER'
  | 'DUPLICATE_TARGET'
  | 'ADAPTER_NOT_FOUND'
  | 'CLIENT_DESTROYED'
  | 'DESTROY_FAILED'
  | 'UNKNOWN_ADAPTER'
  | 'TARGET_NOT_FOUND'
  | 'INVALID_CONFIG'
  | 'INVALID_TARGET'
  | 'INVALID_MESSAGE'
  | 'SEND_FAILED';

export class PushError extends Error {
  readonly code: PushErrorCode;
  override readonly cause?: unknown;

  constructor(code: PushErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = 'PushError';
    this.code = code;
    this.cause = options.cause;
  }
}
