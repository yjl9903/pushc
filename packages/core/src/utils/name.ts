import { PushError } from '../error.js';

export const PUSH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isPushName(input: unknown): input is string {
  return typeof input === 'string' && PUSH_NAME_PATTERN.test(input);
}

export function validatePushName(name: string, label: string): void {
  if (!isPushName(name)) {
    throw new PushError(
      'INVALID_CONFIG',
      `${label} names must start with a letter or digit and use only letters, digits, _ or -.`
    );
  }
}
