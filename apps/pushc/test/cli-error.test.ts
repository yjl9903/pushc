import { describe, expect, it } from 'vitest';
import { breadc } from 'breadc';
import { PushError } from '@pushc/core';
import {
  CliError,
  formatError,
  getErrorExitCode,
  getSendResultExitCode,
  isJsonCliError,
  normalizeError,
  unwrapCliError
} from '../src/error.js';

describe('CLI errors', () => {
  it('preserves the full Breadc context and original cause', () => {
    const cli = breadc('test').option('--json');
    cli.command('send');
    const ctx = cli.parse(['send', '--json']).context;
    const cause = new PushError('TARGET_NOT_FOUND', 'Target "missing" is not defined.');
    const error = new CliError(cause, ctx);

    expect(error.ctx).toBe(ctx);
    expect(error.ctx.command).toBeDefined();
    expect(error.ctx.options.get('json')?.value()).toBe(true);
    expect(unwrapCliError(error)).toBe(cause);
    expect(isJsonCliError(error)).toBe(true);
    expect(normalizeError(cause)).toMatchInlineSnapshot(`
      {
        "code": "TARGET_NOT_FOUND",
        "message": "Target "missing" is not defined.",
      }
    `);
    expect(getErrorExitCode(cause)).toBe(2);
  });

  it('keeps errors without command context as plain internal failures', () => {
    const error = new Error('Could not parse arguments.');

    expect(unwrapCliError(error)).toBe(error);
    expect(isJsonCliError(error)).toBe(false);
    expect(normalizeError(error)).toMatchInlineSnapshot(`
      {
        "code": "INTERNAL_ERROR",
        "message": "Could not parse arguments.",
      }
    `);
    expect(getErrorExitCode(error)).toBe(1);
  });

  it('maps send result codes to process exit codes', () => {
    expect(
      getSendResultExitCode({
        success: true,
        adapter: 'webhook',
        receipt: { request: {} }
      })
    ).toBe(0);
    expect(
      getSendResultExitCode({
        success: false,
        error: { code: 'SEND_FAILED', message: 'offline' }
      })
    ).toBe(1);
    expect(
      getSendResultExitCode({
        success: false,
        error: { code: 'TARGET_NOT_FOUND', message: 'missing' }
      })
    ).toBe(2);
    expect(
      getSendResultExitCode({
        dryRun: true,
        success: true,
        adapter: 'webhook',
        receipt: { request: {} }
      })
    ).toBe(0);
    expect(
      getSendResultExitCode({
        dryRun: true,
        success: false,
        error: { code: 'TARGET_NOT_FOUND', message: 'missing' }
      })
    ).toBe(2);
  });

  it('formats contextual and context-free errors', () => {
    const cli = breadc('test').option('--json');
    cli.command('send');
    const ctx = cli.parse(['send', '--json']).context;
    const error = new CliError(
      new PushError(
        'TARGET_NOT_FOUND',
        'Target "missing" exposed https://example.com/private-token.'
      ),
      ctx,
      ['https://example.com/private-token']
    );

    expect(formatError(error)).toMatchInlineSnapshot(`
      {
        "exitCode": 2,
        "output": "{"success":false,"error":{"code":"TARGET_NOT_FOUND","message":"Target \\"missing\\" exposed [REDACTED]."}}
      ",
      }
    `);
    expect(formatError(new Error('Could not parse arguments.'))).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "output": "Error: Could not parse arguments.
      ",
      }
    `);
  });
});
