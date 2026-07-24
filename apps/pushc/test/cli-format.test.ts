import { describe, expect, it } from 'vitest';
import { PushError } from '@pushc/core';
import { breadc } from 'breadc';
import { CliError } from '../src/utils/error.js';
import { formatError, formatSuccess, formatTargets } from '../src/utils/format.js';

describe('CLI formatting', () => {
  it('formats send results', () => {
    expect(
      formatSuccess(
        {
          target: 'ops',
          adapter: 'webhook',
          receipt: { status: 204 }
        },
        false
      )
    ).toBe('Sent to webhook:ops (HTTP 204).\n');

    expect(JSON.parse(formatSuccess({ adapter: 'webhook', receipt: { status: 204 } }, true)))
      .toMatchInlineSnapshot(`
      {
        "adapter": "webhook",
        "ok": true,
        "receipt": {
          "status": 204,
        },
      }
    `);
  });

  it('formats target lists', () => {
    const targets = [{ adapter: 'webhook' }, { adapter: 'qq', target: 'ops' }];
    expect(formatTargets(targets, false)).toBe('webhook\nqq:ops\n');
    expect(JSON.parse(formatTargets(targets, true))).toMatchInlineSnapshot(`
      {
        "ok": true,
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

  it('formats contextual and context-free errors', () => {
    const cli = breadc('test').option('--json');
    cli.command('send');
    const ctx = cli.parse(['send', '--json']).context;
    const error = new CliError(
      new PushError('TARGET_NOT_FOUND', 'Target "missing" is not defined.'),
      ctx
    );

    expect(formatError(error)).toMatchInlineSnapshot(`
      {
        "exitCode": 2,
        "output": "{"ok":false,"error":{"code":"TARGET_NOT_FOUND","message":"Target \\"missing\\" is not defined."}}
      ",
      }
    `);
    expect(formatError(new Error('Could not parse arguments.'))).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "output": "pushc: Could not parse arguments.
      ",
      }
    `);
  });
});
