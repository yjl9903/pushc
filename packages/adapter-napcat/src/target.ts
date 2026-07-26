import { NapCatError } from './error.js';
import type { NapCatTargetConfig } from './types.js';

const TARGET_FIELDS = new Set(['user_id', 'group_id']);

export function napCatTargetDefaults(input: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(input)) return {};
  return Object.fromEntries(
    [...TARGET_FIELDS].filter((field) => field in input).map((field) => [field, input[field]])
  );
}

export function parseNapCatTarget(input: unknown): NapCatTargetConfig {
  const value = record(input, 'NapCat target configuration must be a table.');
  rejectUnknownTargetFields(value);
  const userId = value.user_id;
  const groupId = value.group_id;
  if ((userId === undefined) === (groupId === undefined)) {
    throw new NapCatError('INVALID_CONFIG', 'Exactly one of user_id or group_id must be provided.');
  }
  return userId === undefined
    ? { group_id: idString(groupId, 'group_id') }
    : { user_id: idString(userId, 'user_id') };
}

export function parseNapCatTargetPartial(input: unknown): Record<string, unknown> {
  const value = record(input, 'NapCat target configuration must be a table.');
  rejectUnknownTargetFields(value);
  return value;
}

function rejectUnknownTargetFields(value: Record<string, unknown>): void {
  for (const field of Object.keys(value)) {
    if (!TARGET_FIELDS.has(field)) {
      throw new NapCatError(
        'INVALID_CONFIG',
        `NapCat targets cannot override adapter field "${field}".`
      );
    }
  }
}

function idString(input: unknown, path: string): string {
  const value = typeof input === 'number' ? String(input) : input;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new NapCatError('INVALID_CONFIG', `${path} must contain only decimal digits.`);
  }
  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue) || numericValue <= 0) {
    throw new NapCatError('INVALID_CONFIG', `${path} must be a positive JavaScript-safe integer.`);
  }
  return value;
}

function record(input: unknown, message: string): Record<string, unknown> {
  if (!isRecord(input)) throw new NapCatError('INVALID_CONFIG', message);
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
