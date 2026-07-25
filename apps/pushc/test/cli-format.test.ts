import { describe, expect, it } from 'vitest';
import { PushError } from '@pushc/core';
import { breadc } from 'breadc';
import { CliError } from '../src/utils/error.js';
import {
  formatError,
  formatSendResult,
  formatTargets,
  getSendResultExitCode
} from '../src/utils/format.js';

describe('CLI formatting', () => {
  it('formats send results', () => {
    expect(
      formatSendResult(
        {
          success: true,
          target: 'ops',
          adapter: 'webhook',
          receipt: {
            summary: 'Webhook POST to example.com completed with HTTP 204.',
            request: { url: 'https://example.com/token', headers: {} },
            response: { status: 204 }
          }
        },
        false
      )
    ).toBe(
      'Send succeeded: webhook:ops\nSummary: Webhook POST to example.com completed with HTTP 204.\n'
    );

    expect(
      JSON.parse(
        formatSendResult(
          {
            success: true,
            adapter: 'webhook',
            receipt: {
              request: { url: 'https://example.com/secret', headers: { authorization: 'secret' } },
              response: { status: 204 }
            }
          },
          true,
          ['secret']
        )
      )
    ).toMatchInlineSnapshot(`
      {
        "adapter": "webhook",
        "receipt": {
          "request": {
            "headers": {
              "authorization": "[REDACTED]",
            },
            "url": "https://example.com/[REDACTED]",
          },
          "response": {
            "status": 204,
          },
        },
        "success": true,
      }
    `);

    expect(
      formatSendResult(
        {
          success: false,
          adapter: 'qq',
          target: 'ops',
          receipt: {
            request: { value: 'long-secret and secret' }
          },
          error: { code: 'SEND_FAILED', message: 'failed with long-secret' }
        },
        false,
        ['long-secret', 'secret']
      )
    ).toBe('Send failed: qq:ops\nError: failed with [REDACTED]\n');

    expect(
      formatSendResult(
        {
          success: false,
          error: { code: 'CONFIG_NOT_FOUND', message: 'No pushc config found.' }
        },
        false
      )
    ).toBe('Error: No pushc config found.\n');
  });

  it('formats dry-run results', () => {
    const ready = {
      dryRun: true as const,
      success: true as const,
      adapter: 'webhook',
      target: 'ops',
      receipt: {
        request: {
          url: 'https://example.com/secret',
          headers: { authorization: 'secret' },
          body: { message: 'hello' }
        }
      }
    };
    expect(formatSendResult(ready, false, ['secret'])).toBe(
      [
        'Dry run ready: webhook:ops',
        'Request:',
        '{',
        '  "url": "https://example.com/[REDACTED]",',
        '  "headers": {',
        '    "authorization": "[REDACTED]"',
        '  },',
        '  "body": {',
        '    "message": "hello"',
        '  }',
        '}',
        ''
      ].join('\n')
    );
    expect(JSON.parse(formatSendResult(ready, true, ['secret']))).toMatchInlineSnapshot(`
      {
        "adapter": "webhook",
        "dryRun": true,
        "receipt": {
          "request": {
            "body": {
              "message": "hello",
            },
            "headers": {
              "authorization": "[REDACTED]",
            },
            "url": "https://example.com/[REDACTED]",
          },
        },
        "success": true,
        "target": "ops",
      }
    `);
    expect(
      formatSendResult(
        {
          dryRun: true,
          success: false,
          adapter: 'webhook',
          target: 'ops',
          error: { code: 'TARGET_NOT_FOUND', message: 'missing' }
        },
        false
      )
    ).toBe('Dry run failed: webhook:ops\nError: missing\n');
  });

  it('formats target lists', () => {
    const targets = [{ adapter: 'webhook' }, { adapter: 'qq', target: 'ops' }];
    expect(formatTargets(targets, false)).toBe('webhook\nqq:ops\n');
    expect(JSON.parse(formatTargets(targets, true))).toMatchInlineSnapshot(`
      {
        "success": true,
        "targets": [
          {
            "adapter": "webhook",
          },
          {
            "adapter": "qq",
            "target": "ops",
          },
        ],
      }
    `);
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
