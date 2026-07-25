import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { parseParamEntries, resolveMessage } from '../src/input.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('resolveMessage', () => {
  it('joins positional content', async () => {
    await expect(resolveMessage({ content: ['hello', 'agent'] })).resolves.toBe('hello agent');
  });

  it('reads files and stdin without trimming content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pushc-input-'));
    directories.push(root);
    const file = join(root, 'message.txt');
    await writeFile(file, 'from file\n');

    await expect(resolveMessage({ file })).resolves.toBe('from file\n');
    await expect(resolveMessage({ stdin: Readable.from(['from ', 'stdin\n']) })).resolves.toBe(
      'from stdin\n'
    );
  });

  it('rejects conflicting and empty sources', async () => {
    await expect(resolveMessage({ content: ['hello'], file: 'message.txt' })).rejects.toMatchObject(
      {
        code: 'MESSAGE_SOURCE_CONFLICT'
      }
    );
    await expect(resolveMessage({ stdin: Readable.from([]) })).rejects.toMatchObject({
      code: 'MESSAGE_EMPTY'
    });
  });

  it('allows empty message sources when attachments are present', async () => {
    await expect(resolveMessage({ stdin: Readable.from([]), allowEmpty: true })).resolves.toBe('');
    await expect(
      resolveMessage({
        stdin: { isTTY: true } as unknown as NodeJS.ReadableStream,
        allowEmpty: true
      })
    ).resolves.toBe('');

    const root = await mkdtemp(join(tmpdir(), 'pushc-empty-input-'));
    directories.push(root);
    const file = join(root, 'empty.txt');
    await writeFile(file, '');
    await expect(resolveMessage({ file, allowEmpty: true })).resolves.toBe('');
  });
});

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
