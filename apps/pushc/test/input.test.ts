import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveMessageInput } from '../src/input/index.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pushc-input-'));
  directories.push(path);
  return path;
}

describe('resolveMessageInput', () => {
  it('turns positional content and CLI fields into a raw PushPayload', async () => {
    const cwd = await tempDirectory();
    await expect(
      resolveMessageInput({
        content: ['hello', 'agent'],
        target: 'qq:ops',
        title: '',
        param: { group: 'deployments' },
        attachments: ['./photo.png'],
        cwd
      })
    ).resolves.toEqual({
      target: 'qq:ops',
      payload: {
        content: 'hello agent',
        attachments: [resolve(cwd, 'photo.png')],
        title: '',
        param: { group: 'deployments' }
      }
    });
  });

  it('keeps .txt files literal even when they contain structured syntax', async () => {
    const root = await tempDirectory();
    const file = join(root, 'message.txt');
    await writeFile(file, '{"target":"webhook","content":"hello"}\n');

    await expect(resolveMessageInput({ file, target: 'qq:ops' })).resolves.toEqual({
      target: 'qq:ops',
      payload: { content: '{"target":"webhook","content":"hello"}\n' }
    });
  });

  it('parses JSON documents and maps attachment fields and paths without normalizing content', async () => {
    const root = await tempDirectory();
    const file = join(root, 'message.json');
    await writeFile(
      file,
      JSON.stringify({
        target: 'qq:ops',
        title: 'Release',
        content: [
          { type: 'text', text: 'before' },
          {
            type: 'attachment',
            source: './report.pdf',
            name: 'release.pdf',
            media_type: 'application/pdf'
          }
        ]
      })
    );

    await expect(resolveMessageInput({ file })).resolves.toEqual({
      target: 'qq:ops',
      payload: {
        title: 'Release',
        content: [
          { type: 'text', text: 'before' },
          {
            type: 'attachment',
            source: join(root, 'report.pdf'),
            name: 'release.pdf',
            mediaType: 'application/pdf'
          }
        ]
      }
    });
  });

  it('parses TOML shorthand and resolves its attachment list from the file directory', async () => {
    const root = await tempDirectory();
    const file = join(root, 'message.toml');
    await writeFile(
      file,
      [
        'target = "qq:ops"',
        'content = ["first", "second"]',
        'attachments = ["./report.pdf", "https://example.com/photo.png"]'
      ].join('\n')
    );

    await expect(resolveMessageInput({ file })).resolves.toEqual({
      target: 'qq:ops',
      payload: {
        content: ['first', 'second'],
        attachments: [join(root, 'report.pdf'), 'https://example.com/photo.png']
      }
    });
  });

  it('uses extension-first syntax fallback and autodetects stdin', async () => {
    const root = await tempDirectory();
    const jsonFile = join(root, 'message.json');
    const tomlFile = join(root, 'message.toml');
    await writeFile(jsonFile, 'content = "from toml"');
    await writeFile(tomlFile, '{"content":"from json"}');

    await expect(resolveMessageInput({ file: jsonFile, target: 'qq' })).resolves.toMatchObject({
      payload: { content: 'from toml' }
    });
    await expect(resolveMessageInput({ file: tomlFile, target: 'qq' })).resolves.toMatchObject({
      payload: { content: 'from json' }
    });
    await expect(
      resolveMessageInput({
        stdin: Readable.from(['{"target":"webhook","content":"from pipe"}'])
      })
    ).resolves.toEqual({
      target: 'webhook',
      payload: { content: 'from pipe' }
    });
    await expect(
      resolveMessageInput({ stdin: Readable.from(['plain pipe\n']), target: 'qq' })
    ).resolves.toEqual({
      target: 'qq',
      payload: { content: 'plain pipe\n' }
    });
  });

  it('does not fall back after structured syntax succeeds', async () => {
    const root = await tempDirectory();
    const file = join(root, 'invalid.json');
    await writeFile(file, '["not", "a", "message document"]');

    await expect(resolveMessageInput({ file })).rejects.toMatchObject({
      code: 'MESSAGE_INVALID',
      message: 'The JSON message must be an object.'
    });
  });

  it('allows target, title, and param overrides for structured messages', async () => {
    const root = await tempDirectory();
    const file = join(root, 'message.json');
    const nullParamFile = join(root, 'null-param.json');
    await writeFile(
      file,
      '{"target":"qq:default","title":"message","content":"hello","param":{"group":"message","environment":"production"}}'
    );
    await writeFile(nullParamFile, '{"content":"hello","param":null}');

    await expect(
      resolveMessageInput({
        file,
        target: 'qq:override',
        title: 'cli',
        param: { group: 'cli', empty: '' }
      })
    ).resolves.toMatchObject({
      target: 'qq:override',
      payload: {
        content: 'hello',
        title: 'cli',
        param: { group: 'cli', environment: 'production', empty: '' }
      }
    });
    await expect(resolveMessageInput({ file, attachments: ['./photo.png'] })).rejects.toMatchObject(
      {
        code: 'CLI_USAGE',
        message: '--attachment cannot be combined with a structured message.'
      }
    );
    await expect(resolveMessageInput({ file: nullParamFile, target: 'qq' })).resolves.toEqual({
      target: 'qq',
      payload: { content: 'hello', param: null }
    });
    await expect(
      resolveMessageInput({
        file: nullParamFile,
        target: 'qq',
        param: { group: 'cli' }
      })
    ).resolves.toEqual({
      target: 'qq',
      payload: { content: 'hello', param: { group: 'cli' } }
    });
  });

  it('rejects source conflicts, empty input, and duplicate media type spellings', async () => {
    const root = await tempDirectory();
    const file = join(root, 'message.json');
    await writeFile(
      file,
      '{"content":[{"type":"attachment","source":"x","media_type":"text/plain","mediaType":"text/plain"}]}'
    );

    await expect(resolveMessageInput({ content: ['hello'], file })).rejects.toMatchObject({
      code: 'MESSAGE_SOURCE_CONFLICT'
    });
    await expect(resolveMessageInput({ stdin: Readable.from([]) })).rejects.toMatchObject({
      code: 'MESSAGE_EMPTY'
    });
    await expect(resolveMessageInput({ file })).rejects.toMatchObject({
      code: 'MESSAGE_INVALID'
    });
  });

  it('preserves blank structured attachment sources for core validation', async () => {
    const root = await tempDirectory();
    const astFile = join(root, 'ast.json');
    const shortcutFile = join(root, 'shortcut.json');
    await writeFile(astFile, '{"content":[{"type":"attachment","source":""}]}');
    await writeFile(shortcutFile, '{"content":"","attachments":["   "]}');

    await expect(resolveMessageInput({ file: astFile, target: 'qq' })).resolves.toEqual({
      target: 'qq',
      payload: {
        content: [{ type: 'attachment', source: '' }]
      }
    });
    await expect(resolveMessageInput({ file: shortcutFile, target: 'qq' })).resolves.toEqual({
      target: 'qq',
      payload: {
        content: '',
        attachments: ['   ']
      }
    });
  });

  it('supports attachment-only text input without reading a TTY', async () => {
    const cwd = await tempDirectory();
    await expect(
      resolveMessageInput({
        stdin: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        target: 'qq',
        attachments: ['./photo.png'],
        cwd
      })
    ).resolves.toEqual({
      target: 'qq',
      payload: {
        content: '',
        attachments: [join(cwd, 'photo.png')]
      }
    });
  });
});
