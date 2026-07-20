import type { PushResult } from '@pushc/core';
import { getErrorExitCode, isJsonCliError, normalizeError, unwrapCliError } from './error.js';
import { formatTargetAddress } from './target-address.js';
import { isRecord } from './value.js';

export interface CliTargetSummary {
  adapter: string;
  target?: string;
}

export interface CliFailure {
  output: string;
  exitCode: number;
}

export function formatSuccess(result: PushResult, json: boolean): string {
  if (json) {
    return `${JSON.stringify({ ok: true, ...result })}\n`;
  }

  let detail = '';
  if (isRecord(result.receipt) && typeof result.receipt.messageId === 'string') {
    detail = ` (message ${result.receipt.messageId})`;
  } else if (isRecord(result.receipt) && typeof result.receipt.status === 'number') {
    detail = ` (HTTP ${result.receipt.status})`;
  }
  return `Sent to ${formatTargetAddress(result.adapter, result.target)}${detail}.\n`;
}

export function formatTargets(targets: readonly CliTargetSummary[], json: boolean): string {
  if (json) {
    return `${JSON.stringify({ ok: true, targets })}\n`;
  }
  if (targets.length === 0) {
    return 'No targets configured.\n';
  }
  return `${targets
    .map((target) => formatTargetAddress(target.adapter, target.target))
    .join('\n')}\n`;
}

export function formatError(error: unknown): CliFailure {
  const cause = unwrapCliError(error);
  const normalized = normalizeError(cause);
  return {
    output: isJsonCliError(error)
      ? `${JSON.stringify({ ok: false, error: normalized })}\n`
      : `pushc: ${normalized.message}\n`,
    exitCode: getErrorExitCode(cause)
  };
}
