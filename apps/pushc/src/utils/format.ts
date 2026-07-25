import { formatDestination, type PushDryRunResult, type PushResult } from '@pushc/core';
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
  result: PushResult | PushDryRunResult,
  json: boolean,
  redactions: readonly string[] = []
): string {
  if (result.dryRun === true) {
    return formatDryRunResult(result, json, redactions);
  }

  const output = redactForOutput(result, redactions);
  if (json) {
    return `${JSON.stringify(output)}\n`;
  } else {
    if (!output.success) {
      const destination =
        output.adapter === undefined
          ? ''
          : `Send failed: ${formatDestination(output.adapter, output.target)}\n`;
      return `${destination}Error: ${output.error.message}\n`;
    } else {
      return `Send succeeded: ${formatDestination(output.adapter, output.target)}\n${
        output.receipt.summary ? `Summary: ${output.receipt.summary}\n` : ''
      }`;
    }
  }
}

function formatDryRunResult(
  result: PushDryRunResult,
  json: boolean,
  redactions: readonly string[]
): string {
  const output = redactForOutput(result, redactions);
  if (json) {
    return `${JSON.stringify(output)}\n`;
  } else {
    const destination =
      output.adapter === undefined ? undefined : formatDestination(output.adapter, output.target);
    const request =
      output.receipt === undefined
        ? ''
        : `Request:\n${JSON.stringify(output.receipt.request, undefined, 2)}\n`;
    if (!output.success) {
      return `${destination === undefined ? '' : `Dry run failed: ${destination}\n`}${request}Error: ${
        output.error.message
      }\n`;
    }
    return `Dry run ready: ${destination}\n${request}`;
  }
}

export function formatTargets(targets: readonly CliTargetSummary[], json: boolean): string {
  if (json) {
    return `${JSON.stringify({ success: true, targets })}\n`;
  } else {
    if (targets.length === 0) {
      return 'No targets configured.\n';
    } else {
      return `${targets
        .map((target) => formatDestination(target.adapter, target.target))
        .join('\n')}\n`;
    }
  }
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
