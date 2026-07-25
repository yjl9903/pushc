import { formatDestination, type PushResult } from '@pushc/core';
import {
  cliErrorRedactions,
  getErrorCodeExitCode,
  getErrorExitCode,
  isJsonCliError,
  normalizeError,
  unwrapCliError
} from './error.js';
import { redactForOutput } from './redact.js';

export interface CliTargetSummary {
  adapter: string;
  target?: string;
}

export interface CliFailure {
  output: string;
  exitCode: number;
}

export function formatSendResult(
  result: PushResult,
  json: boolean,
  redactions: readonly string[] = []
): string {
  const output = redactForOutput(result, redactions);
  if (json) {
    return `${JSON.stringify(output)}\n`;
  }

  if (!output.success) {
    const destination =
      output.adapter === undefined
        ? ''
        : `Send failed: ${formatDestination(output.adapter, output.target)}\n`;
    return `${destination}Error: ${output.error.message}\n`;
  }
  return `Send succeeded: ${formatDestination(output.adapter, output.target)}\n${
    output.receipt.summary ? `Summary: ${output.receipt.summary}\n` : ''
  }`;
}

export function formatTargets(targets: readonly CliTargetSummary[], json: boolean): string {
  if (json) {
    return `${JSON.stringify({ success: true, targets })}\n`;
  }
  if (targets.length === 0) {
    return 'No targets configured.\n';
  }
  return `${targets
    .map((target) => formatDestination(target.adapter, target.target))
    .join('\n')}\n`;
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

export function getSendResultExitCode(result: PushResult): number {
  return result.success ? 0 : getErrorCodeExitCode(result.error.code);
}
