import { PushError, type PushDryRunResult, type PushResult } from '@pushc/core';
import { BreadcError, type Breadc } from 'breadc';

import { redactForOutput } from './utils/redact.js';

export type ConfigErrorCode =
  'CONFIG_NOT_FOUND' | 'CONFIG_READ_FAILED' | 'CONFIG_INVALID' | 'ENV_MISSING';

export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ConfigError';
    this.code = code;
  }
}

export type MessageInputErrorCode =
  'MESSAGE_SOURCE_CONFLICT' | 'MESSAGE_FILE_FAILED' | 'MESSAGE_INVALID' | 'MESSAGE_EMPTY';

export class MessageInputError extends Error {
  readonly code: MessageInputErrorCode;

  constructor(code: MessageInputErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'MessageInputError';
    this.code = code;
  }
}

export class CliUsageError extends Error {
  readonly code = 'CLI_USAGE';

  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export interface NormalizedError {
  code: string;
  message: string;
}

export interface CliFailure {
  output: string;
  exitCode: number;
}

export type CliContext = ReturnType<Breadc['parse']>['context'];

export class CliError extends Error {
  readonly ctx: CliContext;
  readonly redactions: readonly string[];

  constructor(cause: unknown, ctx: CliContext, redactions: readonly string[] = []) {
    super(normalizeError(cause).message, { cause });
    this.name = 'CliError';
    this.ctx = ctx;
    this.redactions = redactions;
  }
}

export function cliErrorRedactions(error: unknown): readonly string[] {
  return error instanceof CliError ? error.redactions : [];
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
    error instanceof MessageInputError ||
    error instanceof CliUsageError
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

export function getErrorExitCode(error: unknown): number {
  return getErrorCodeExitCode(normalizeError(error).code);
}

export function getErrorCodeExitCode(code: string): number {
  return code === 'SEND_FAILED' || code === 'DESTROY_FAILED' || code === 'INTERNAL_ERROR' ? 1 : 2;
}

export function formatError(error: unknown): CliFailure {
  const cause = unwrapCliError(error);
  const normalized = redactForOutput(normalizeError(cause), cliErrorRedactions(error));

  return {
    output: isJsonCliError(error)
      ? `${JSON.stringify({ success: false, error: normalized })}\n`
      : `Error: ${normalized.message}\n`,
    exitCode: getErrorExitCode(cause)
  };
}

export function getSendResultExitCode(result: PushResult | PushDryRunResult): number {
  return result.success ? 0 : getErrorCodeExitCode(result.error.code);
}
