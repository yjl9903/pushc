export type NapCatErrorCode = 'INVALID_CONFIG' | 'ABORTED';

export class NapCatError extends Error {
  readonly code: NapCatErrorCode;

  constructor(code: NapCatErrorCode, message: string) {
    super(message);
    this.name = 'NapCatError';
    this.code = code;
  }
}
