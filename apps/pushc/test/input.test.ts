import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMessage } from '../src/input.js';

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
});
