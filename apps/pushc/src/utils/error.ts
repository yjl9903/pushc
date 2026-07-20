import { PushError } from '@pushc/core';
import { BreadcError, type Breadc } from 'breadc';
import { ConfigError } from '../config.js';
import { MessageInputError } from '../input.js';

export interface NormalizedError {
  code: string;
  message: string;
}

export type CliContext = ReturnType<Breadc['parse']>['context'];

export class CliError extends Error {
  readonly ctx: CliContext;
  override readonly cause: unknown;

  constructor(cause: unknown, ctx: CliContext) {
    super(normalizeError(cause).message);
    this.name = 'CliError';
    this.ctx = ctx;
    this.cause = cause;
  }
}

export function unwrapCliError(error: unknown): unknown {
  return error instanceof CliError ? error.cause : error;
}

export function isJsonCliError(error: unknown): boolean {
  return error instanceof CliError && error.ctx.options.get('json')?.value() === true;
}

export function normalizeError(error: unknown): NormalizedError {
  if (
    error instanceof PushError ||
    error instanceof ConfigError ||
    error instanceof MessageInputError
  ) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof BreadcError) {
    return { code: 'CLI_USAGE', message: error.message };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error && error.message ? error.message : 'Unknown error'
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown error';
}

export function getErrorExitCode(error: unknown): number {
  if (
    error instanceof ConfigError ||
    error instanceof MessageInputError ||
    error instanceof BreadcError
  ) {
    return 2;
  }
  if (error instanceof PushError && error.code !== 'SEND_FAILED') {
    return 2;
  }
  return 1;
}
