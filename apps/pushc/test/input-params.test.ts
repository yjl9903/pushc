import { describe, expect, it } from 'vitest';

import type { PushPayload } from '@pushc/core';

import { applyParamOverrides, parseParamEntries } from '../src/input/params.js';

describe('parseParamEntries', () => {
  it('splits on the first equals and preserves empty and whitespace values', () => {
    expect(parseParamEntries(['group=deployments', 'query=a=b', 'empty=', 'space= ']))
      .toMatchInlineSnapshot(`
      {
        "empty": "",
        "group": "deployments",
        "query": "a=b",
        "space": " ",
      }
    `);
    expect(parseParamEntries([])).toBeUndefined();
  });

  it('rejects invalid entries', () => {
    const invalidEntries = [['missing'], ['=empty'], ['bad key=value'], ['same=one', 'same=two']];

    expect(invalidEntries.map((entries) => captureError(() => parseParamEntries(entries))))
      .toMatchInlineSnapshot(`
        [
          {
            "code": "CLI_USAGE",
            "message": "--param entries must use key=value with keys containing only letters, digits, _, . or -.",
            "name": "CliUsageError",
          },
          {
            "code": "CLI_USAGE",
            "message": "--param entries must use key=value with keys containing only letters, digits, _, . or -.",
            "name": "CliUsageError",
          },
          {
            "code": "CLI_USAGE",
            "message": "--param entries must use key=value with keys containing only letters, digits, _, . or -.",
            "name": "CliUsageError",
          },
          {
            "code": "CLI_USAGE",
            "message": "Duplicate --param key "same".",
            "name": "CliUsageError",
          },
        ]
      `);
  });

  it('applies CLI overrides to message file params', () => {
    const payload = {
      content: 'release',
      param: { group: 'message', environment: 'production' }
    } as const;

    const merged = applyParamOverrides(payload, {
      group: 'cli',
      empty: ''
    });

    expect(merged).toEqual({
      content: 'release',
      param: {
        group: 'cli',
        environment: 'production',
        empty: ''
      }
    });
    expect(payload.param).toEqual({ group: 'message', environment: 'production' });
    expect(applyParamOverrides(payload, undefined)).toBe(payload);
    expect(applyParamOverrides({ content: 'release', param: null }, { group: 'cli' })).toEqual({
      content: 'release',
      param: { group: 'cli' }
    });
  });

  it('merges plain record params before core validation', () => {
    const payload = {
      content: 'release',
      param: { group: 1, unchanged: false }
    } as unknown as PushPayload;

    expect(applyParamOverrides(payload, { group: 'cli' })).toEqual({
      content: 'release',
      param: { group: 'cli', unchanged: false }
    });
  });

  it('leaves non-plain message params unchanged for core validation', () => {
    const invalidPayloads = [
      { content: 'release', param: 'bad' },
      { content: 'release', param: ['bad'] },
      { content: 'release', param: new Date(0) }
    ] as unknown as PushPayload[];

    for (const payload of invalidPayloads) {
      expect(applyParamOverrides(payload, { group: 'cli' })).toBe(payload);
    }
  });
});

function captureError(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    if (!(error instanceof Error)) return error;
    return {
      name: error.name,
      ...('code' in error ? { code: error.code } : {}),
      message: error.message
    };
  }
  throw new Error('Expected callback to throw.');
}
