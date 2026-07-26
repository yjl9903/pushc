import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NapCatAdapter,
  parseNapCatConfig,
  parseNapCatTarget,
  type NapCatClient
} from '../src/index.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

function mockClient(): NapCatClient {
  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    send_msg: vi.fn(async () => ({ message_id: 42 }))
  };
}

describe('napcat adapter', () => {
  it('prepares the final request in dry-run without creating a connection', async () => {
    const factory = vi.fn(() => mockClient());
    const adapter = new NapCatAdapter(
      { base_url: 'ws://127.0.0.1:3001', access_token: 'secret' },
      { factory }
    );

    await expect(
      adapter.send(
        { group_id: '123456' },
        { content: 'hello', title: 'ignored', param: { x: 'ignored' } },
        { dryRun: true }
      )
    ).resolves.toEqual({
      dryRun: true,
      success: true,
      receipt: {
        request: {
          method: 'send_msg',
          params: {
            group_id: 123456,
            message: [{ type: 'text', data: { text: 'hello' } }]
          }
        }
      }
    });
    expect(factory).not.toHaveBeenCalled();
    await adapter.destroy();
  });

  it.each([
    [
      'user',
      { user_id: '123456' },
      { user_id: 123456 },
      'NapCat sent a message to user 123456 (message ID: 42).'
    ],
    [
      'group',
      { group_id: '123456' },
      { group_id: 123456 },
      'NapCat sent a message to group 123456 (message ID: 42).'
    ]
  ] as const)(
    'reuses one connection config to send a %s target',
    async (_targetType, targetConfig, recipient, summary) => {
      const client = mockClient();
      const factory = vi.fn(() => client);
      const adapter = new NapCatAdapter(
        { base_url: 'ws://127.0.0.1:3001', access_token: 'secret' },
        { factory }
      );
      await expect(
        adapter.send(targetConfig, { content: 'hello', title: 'ignored', param: { x: 'ignored' } })
      ).resolves.toEqual({
        success: true,
        receipt: {
          summary,
          request: {
            method: 'send_msg',
            params: {
              ...recipient,
              message: [{ type: 'text', data: { text: 'hello' } }]
            }
          },
          response: { messageId: '42' }
        }
      });
      expect(client.connect).toHaveBeenCalledOnce();
      expect(client.send_msg).toHaveBeenCalledWith({
        ...recipient,
        message: [{ type: 'text', data: { text: 'hello' } }]
      });
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(factory).toHaveBeenCalledWith({
        baseUrl: 'ws://127.0.0.1:3001/',
        accessToken: 'secret',
        apiTimeout: 10_000
      });
      await adapter.destroy();
      expect(client.disconnect).toHaveBeenCalledOnce();
    }
  );

  it('creates configured instances directly through its constructor', () => {
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory: vi.fn() });

    expect(adapter.config).toMatchInlineSnapshot(`
      {
        "base_url": "ws://localhost:3001/",
        "max_attachment_bytes": 33554432,
        "timeout_ms": 10000,
      }
    `);
  });

  it('inherits native target defaults across named targets and rejects connection overrides', () => {
    const adapter = new NapCatAdapter({
      base_url: 'ws://localhost:3001',
      group_id: '123'
    });

    adapter.targets.register('ops', {}).register('alerts', { group_id: '456' });
    expect(adapter.targets.get('ops')).toMatchInlineSnapshot(`
      {
        "group_id": "123",
      }
    `);
    expect(adapter.targets.get('alerts')).toMatchInlineSnapshot(`
      {
        "group_id": "456",
      }
    `);
    expect(captureError(() => adapter.targets.register('invalid', { base_url: 'ws://other:3001' })))
      .toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Invalid configuration for target "invalid": NapCat targets cannot override adapter field "base_url".",
        "name": "PushError",
      }
    `);
  });

  it('keeps the shared connection and normalizes SDK failure objects', async () => {
    const client = mockClient();
    const failures: unknown[] = [
      {
        status: 'failed',
        retcode: 1200,
        data: null,
        message: 'permission denied',
        echo: 'first'
      },
      {
        status: 'failed',
        retcode: -1,
        data: null,
        echo: 'second'
      }
    ];
    client.send_msg = vi.fn(async () => {
      throw failures.shift();
    });
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001' },
      { factory: () => client }
    );

    await expect(adapter.send({ group_id: '123' }, { content: 'hello' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'permission denied' }
    });
    await expect(adapter.send({ group_id: '123' }, { content: 'again' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'NapCat failed to send the message.' }
    });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.disconnect).not.toHaveBeenCalled();
    await adapter.destroy();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('validates WebSocket URLs separately from native target IDs', () => {
    expect(() => parseNapCatConfig({ base_url: 'https://localhost' })).toThrow(/ws or wss/);
    expect(() => parseNapCatConfig({ baseUrl: 'ws://localhost' })).toThrow(
      /Unknown NapCat configuration field/
    );
    expect(() => parseNapCatConfig({ base_url: 'ws://localhost', timeot_ms: 5 })).toThrow(
      /Unknown NapCat configuration field/
    );
    expect(() =>
      parseNapCatConfig({ base_url: 'ws://localhost', max_attachment_bytes: 0 })
    ).toThrow(/positive integer/);
    expect(() => parseNapCatTarget({})).toThrow(/Exactly one/);
    expect(() => parseNapCatTarget({ userId: '123' })).toThrow(/cannot override/);
    expect(() => parseNapCatTarget({ user_id: '123', group_id: '456' })).toThrow(/Exactly one/);
    expect(() => parseNapCatTarget({ group_id: 'not-a-number' })).toThrow(/decimal digits/);
  });

  it('disconnects after an aborted operation', async () => {
    const client = mockClient();
    client.connect = vi.fn(() => new Promise<void>(() => undefined));
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001', timeout_ms: 5 },
      { factory: () => client }
    );

    await expect(adapter.send({ user_id: '123' }, { content: 'hello' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: expect.stringContaining('timed out') }
    });
    expect(client.disconnect).not.toHaveBeenCalled();
    await adapter.destroy();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('does not start dispatch when the caller aborts during preparation', async () => {
    const client = mockClient();
    client.connect = vi.fn(() => new Promise<void>(() => undefined));
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001' },
      { factory: () => client }
    );
    const controller = new AbortController();

    const sending = adapter.send(
      { user_id: '123' },
      { content: 'hello' },
      { signal: controller.signal }
    );
    controller.abort(new Error('cancelled by caller'));

    await expect(sending).resolves.toMatchObject({
      success: false,
      receipt: {
        request: {
          method: 'send_msg',
          params: {
            user_id: 123,
            message: [{ type: 'text', data: { text: 'hello' } }]
          }
        }
      },
      error: { code: 'SEND_FAILED', message: 'Message sending was aborted.' }
    });
    await adapter.destroy();
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('lazily creates one connection and reuses it across sends', async () => {
    const client = mockClient();
    const factory = vi.fn(() => client);
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });
    const target = { group_id: '123' };

    expect(factory).not.toHaveBeenCalled();
    await adapter.send(target, { content: 'first' });
    await adapter.send(target, { content: 'second' });

    expect(factory).toHaveBeenCalledOnce();
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.send_msg).toHaveBeenCalledTimes(2);
    expect(client.disconnect).not.toHaveBeenCalled();

    await Promise.all([adapter.destroy(), adapter.destroy()]);
    expect(client.disconnect).toHaveBeenCalledOnce();
    await expect(adapter.send(target, { content: 'after destroy' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: expect.stringContaining('aborted') }
    });
  });

  it('shares the first connection promise across concurrent sends', async () => {
    let resolveConnect: (() => void) | undefined;
    const client = mockClient();
    client.connect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        })
    );
    const factory = vi.fn(() => client);
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });
    const target = { user_id: '123' };

    const first = adapter.send(target, { content: 'first' });
    const second = adapter.send(target, { content: 'second' });
    await vi.waitFor(() => {
      expect(factory).toHaveBeenCalledOnce();
      expect(client.connect).toHaveBeenCalledOnce();
    });
    resolveConnect?.();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(client.send_msg).toHaveBeenCalledTimes(2);
    await adapter.destroy();
  });

  it('clears a failed lazy connection so the next send can retry', async () => {
    const failedClient = mockClient();
    failedClient.connect = vi.fn(async () => {
      throw new Error('connect failed');
    });
    const connectedClient = mockClient();
    const factory = vi
      .fn<() => NapCatClient>()
      .mockReturnValueOnce(failedClient)
      .mockReturnValueOnce(connectedClient);
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });
    const target = { group_id: '123' };

    await expect(adapter.send(target, { content: 'first' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'connect failed' }
    });
    await expect(adapter.send(target, { content: 'second' })).resolves.toMatchObject({
      success: true,
      receipt: { response: { messageId: '42' } }
    });

    expect(factory).toHaveBeenCalledTimes(2);
    expect(failedClient.disconnect).toHaveBeenCalledOnce();
    await adapter.destroy();
    expect(connectedClient.disconnect).toHaveBeenCalledOnce();
  });

  it('sends ordered local attachment segments before text without exposing file data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pushc-napcat-attachments-'));
    directories.push(root);
    const fixtures = [
      ['photo.PNG', 'image'],
      ['sound.MP3', 'audio'],
      ['clip.MP4', 'video'],
      ['report.unknown-extension', 'file']
    ] as const;
    for (const [name, contents] of fixtures) {
      await writeFile(join(root, name), contents);
    }

    const client = mockClient();
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001' },
      { factory: () => client }
    );
    const result = await adapter.send(
      { group_id: '123' },
      { content: 'caption', attachments: fixtures.map(([name]) => join(root, name)) }
    );

    expect(result).toEqual({
      success: true,
      receipt: {
        summary: 'NapCat sent a message to group 123 (message ID: 42).',
        request: {
          method: 'send_msg',
          params: {
            group_id: 123,
            message: [
              attachmentReceipt('image', 'photo.PNG', 'image/png', 'image'),
              attachmentReceipt('record', 'sound.MP3', 'audio/mpeg', 'audio'),
              attachmentReceipt('video', 'clip.MP4', 'video/mp4', 'video'),
              attachmentReceipt(
                'file',
                'report.unknown-extension',
                'application/octet-stream',
                'file'
              ),
              { type: 'text', data: { text: 'caption' } }
            ]
          }
        },
        response: { messageId: '42' }
      }
    });
    expect(client.send_msg).toHaveBeenCalledWith({
      group_id: 123,
      message: [
        attachmentTransport('image', 'image'),
        attachmentTransport('record', 'audio'),
        attachmentTransport('video', 'video'),
        attachmentTransport('file', 'file', 'report.unknown-extension'),
        { type: 'text', data: { text: 'caption' } }
      ]
    });
    expect(JSON.stringify(result)).not.toContain('base64://');
    expect(JSON.stringify(result)).not.toContain(root);
    await adapter.destroy();
  });

  it('preserves explicit AST order and attachment metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pushc-napcat-ast-'));
    directories.push(root);
    const file = join(root, 'contents.bin');
    await writeFile(file, 'image');
    const client = mockClient();
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001' },
      { factory: () => client }
    );

    const result = await adapter.send(
      { group_id: '123' },
      {
        content: [
          { type: 'text', text: 'before' },
          { type: 'text', text: ' \n ' },
          {
            type: 'attachment',
            source: file,
            name: 'photo.png',
            mediaType: 'Image/PNG'
          },
          { type: 'text', text: 'after' }
        ]
      }
    );

    expect(result).toMatchObject({
      success: true,
      receipt: {
        request: {
          params: {
            message: [
              { type: 'text', data: { text: 'before' } },
              { type: 'text', data: { text: ' \n ' } },
              attachmentReceipt('image', 'photo.png', 'Image/PNG', 'image'),
              { type: 'text', data: { text: 'after' } }
            ]
          }
        }
      }
    });
    expect(client.send_msg).toHaveBeenCalledWith({
      group_id: 123,
      message: [
        { type: 'text', data: { text: 'before' } },
        { type: 'text', data: { text: ' \n ' } },
        attachmentTransport('image', 'image'),
        { type: 'text', data: { text: 'after' } }
      ]
    });
    await adapter.destroy();
  });

  it.skipIf(process.platform === 'win32')(
    'treats a relative filename containing a colon as a local attachment',
    async () => {
      const root = await mkdtemp(join(process.cwd(), 'pushc-notes:'));
      directories.push(root);
      const path = join(root, 'final.txt');
      const source = relative(process.cwd(), path);
      await writeFile(path, 'notes');
      const factory = vi.fn(() => mockClient());
      const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });

      await expect(
        adapter.send({ user_id: '123' }, { content: '', attachments: [source] }, { dryRun: true })
      ).resolves.toEqual({
        dryRun: true,
        success: true,
        receipt: {
          request: {
            method: 'send_msg',
            params: {
              user_id: 123,
              message: [
                attachmentReceipt('file', 'final.txt', 'text/plain', 'notes'),
                { type: 'text', data: { text: '' } }
              ]
            }
          }
        }
      });
      expect(factory).not.toHaveBeenCalled();
      await adapter.destroy();
    }
  );

  it('fully prepares attachments in dry-run without creating a client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pushc-napcat-dry-run-'));
    directories.push(root);
    const file = join(root, 'photo.png');
    await writeFile(file, 'image');
    const factory = vi.fn(() => mockClient());
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });

    await expect(
      adapter.send({ user_id: '123' }, { content: '  ', attachments: [file] }, { dryRun: true })
    ).resolves.toEqual({
      dryRun: true,
      success: true,
      receipt: {
        request: {
          method: 'send_msg',
          params: {
            user_id: 123,
            message: [
              attachmentReceipt('image', 'photo.png', 'image/png', 'image'),
              { type: 'text', data: { text: '  ' } }
            ]
          }
        }
      }
    });
    expect(factory).not.toHaveBeenCalled();
    await adapter.destroy();
  });

  it('passes remote attachments directly to NapCat without downloading them', async () => {
    const urls = [
      'https://cdn.example.com/photo.JPEG?token=secret',
      'http://media.example.com/sound.mp3',
      'https://media.example.com/clip.mp4',
      'https://files.example.com/report.pdf'
    ];
    const client = mockClient();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      const contentType = url.includes('photo.')
        ? 'image/jpeg'
        : url.includes('sound.')
          ? 'audio/mpeg'
          : url.includes('clip.')
            ? 'video/mp4'
            : 'application/pdf';
      return new Response(null, { headers: { 'content-type': contentType } });
    });
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001' },
      { factory: () => client, fetch }
    );

    const result = await adapter.send({ group_id: '123' }, { content: '', attachments: urls });

    expect(result).toEqual({
      success: true,
      receipt: {
        summary: 'NapCat sent a message to group 123 (message ID: 42).',
        request: {
          method: 'send_msg',
          params: {
            group_id: 123,
            message: [
              remoteAttachmentReceipt('image', 'photo.JPEG', 'image/jpeg', 'cdn.example.com'),
              remoteAttachmentReceipt('record', 'sound.mp3', 'audio/mpeg', 'media.example.com'),
              remoteAttachmentReceipt('video', 'clip.mp4', 'video/mp4', 'media.example.com'),
              remoteAttachmentReceipt('file', 'report.pdf', 'application/pdf', 'files.example.com'),
              { type: 'text', data: { text: '' } }
            ]
          }
        },
        response: { messageId: '42' }
      }
    });
    expect(client.send_msg).toHaveBeenCalledWith({
      group_id: 123,
      message: [
        remoteAttachmentTransport('image', urls[0]!),
        remoteAttachmentTransport('record', urls[1]!),
        remoteAttachmentTransport('video', urls[2]!),
        remoteAttachmentTransport('file', urls[3]!, 'report.pdf'),
        { type: 'text', data: { text: '' } }
      ]
    });
    expect(fetch).toHaveBeenCalledTimes(urls.length);
    expect(fetch).toHaveBeenCalledWith(urls[0], {
      method: 'HEAD',
      redirect: 'follow',
      signal: expect.any(AbortSignal)
    });
    expect(JSON.stringify(result)).not.toContain('token=secret');
    await adapter.destroy();
  });

  it('keeps an explicit remote media type without probing it', async () => {
    const url = 'https://cdn.example.com/photo';
    const client = mockClient();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { headers: { 'content-type': 'text/plain' } })
    );
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001' },
      { factory: () => client, fetch }
    );

    await expect(
      adapter.send(
        { group_id: '123' },
        {
          content: [
            {
              type: 'attachment',
              source: url,
              name: 'photo.png',
              mediaType: 'Image/PNG'
            }
          ]
        }
      )
    ).resolves.toEqual({
      success: true,
      receipt: {
        summary: 'NapCat sent a message to group 123 (message ID: 42).',
        request: {
          method: 'send_msg',
          params: {
            group_id: 123,
            message: [remoteAttachmentReceipt('image', 'photo.png', 'Image/PNG', 'cdn.example.com')]
          }
        },
        response: { messageId: '42' }
      }
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(client.send_msg).toHaveBeenCalledWith({
      group_id: 123,
      message: [remoteAttachmentTransport('image', url)]
    });
    await adapter.destroy();
  });

  it('probes remote media types concurrently and preserves attachment order', async () => {
    const urls = [
      'https://cdn.example.com/one',
      'https://cdn.example.com/two',
      'https://cdn.example.com/three'
    ];
    const probes = urls.map(() => Promise.withResolvers<Response>());
    let probeIndex = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(() => probes[probeIndex++]!.promise);
    const client = mockClient();
    const factory = vi.fn(() => client);
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory, fetch });

    const sending = adapter.send({ group_id: '123' }, { content: '', attachments: urls });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(urls.length));
    expect(factory).not.toHaveBeenCalled();

    probes[2]!.resolve(new Response(null, { headers: { 'content-type': 'audio/mpeg' } }));
    probes[1]!.resolve(new Response(null, { headers: { 'content-type': 'application/pdf' } }));
    probes[0]!.resolve(new Response(null, { headers: { 'content-type': 'image/png' } }));

    await expect(sending).resolves.toMatchObject({
      success: true,
      receipt: {
        request: {
          params: {
            message: [
              remoteAttachmentReceipt('image', 'one', 'image/png', 'cdn.example.com'),
              remoteAttachmentReceipt('file', 'two', 'application/pdf', 'cdn.example.com'),
              remoteAttachmentReceipt('record', 'three', 'audio/mpeg', 'cdn.example.com'),
              { type: 'text', data: { text: '' } }
            ]
          }
        }
      }
    });
    expect(client.send_msg).toHaveBeenCalledWith({
      group_id: 123,
      message: [
        remoteAttachmentTransport('image', urls[0]!),
        remoteAttachmentTransport('file', urls[1]!, 'two'),
        remoteAttachmentTransport('record', urls[2]!),
        { type: 'text', data: { text: '' } }
      ]
    });
    await adapter.destroy();
  });

  it('limits remote media type probing to eight concurrent requests', async () => {
    const urls = Array.from({ length: 9 }, (_, index) => `https://cdn.example.com/file-${index}`);
    const probes = urls.map(() => Promise.withResolvers<Response>());
    let probeIndex = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(() => probes[probeIndex++]!.promise);
    const client = mockClient();
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001' },
      { factory: () => client, fetch }
    );

    const sending = adapter.send({ group_id: '123' }, { content: '', attachments: urls });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(8));
    expect(fetch).toHaveBeenCalledTimes(8);

    probes[0]!.resolve(new Response(null));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(9));
    for (const probe of probes.slice(1)) {
      probe.resolve(new Response(null));
    }

    await expect(sending).resolves.toMatchObject({ success: true });
    expect(client.send_msg).toHaveBeenCalledOnce();
    await adapter.destroy();
  });

  it('refines an extensionless remote attachment from its response Content-Type', async () => {
    const url = 'https://pbs.twimg.com/media/HOBmCuNaUAAtnyv?format=jpg&name=4096x4096';
    const client = mockClient();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(null, {
          headers: { 'content-type': 'image/jpeg; charset=binary' }
        })
    );
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001' },
      { factory: () => client, fetch }
    );

    await expect(
      adapter.send({ group_id: '123' }, { content: '', attachments: [url] })
    ).resolves.toEqual({
      success: true,
      receipt: {
        summary: 'NapCat sent a message to group 123 (message ID: 42).',
        request: {
          method: 'send_msg',
          params: {
            group_id: 123,
            message: [
              remoteAttachmentReceipt('image', 'HOBmCuNaUAAtnyv', 'image/jpeg', 'pbs.twimg.com'),
              { type: 'text', data: { text: '' } }
            ]
          }
        },
        response: { messageId: '42' }
      }
    });
    expect(client.send_msg).toHaveBeenCalledWith({
      group_id: 123,
      message: [remoteAttachmentTransport('image', url), { type: 'text', data: { text: '' } }]
    });
    await adapter.destroy();
  });

  it('does not connect when remote media type probing times out', async () => {
    const client = mockClient();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => undefined));
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001', timeout_ms: 5 },
      { factory: () => client, fetch }
    );

    await expect(
      adapter.send(
        { group_id: '123' },
        { content: '', attachments: ['https://cdn.example.com/photo'] }
      )
    ).resolves.toMatchObject({
      success: false,
      receipt: {
        request: {
          params: {
            message: [
              remoteAttachmentReceipt(
                'file',
                'photo',
                'application/octet-stream',
                'cdn.example.com'
              ),
              { type: 'text', data: { text: '' } }
            ]
          }
        }
      },
      error: { code: 'SEND_FAILED', message: expect.stringContaining('timed out') }
    });
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.send_msg).not.toHaveBeenCalled();
    await adapter.destroy();
  });

  it('does not download remote attachments during dry-run', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const factory = vi.fn(() => mockClient());
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });

    try {
      await expect(
        adapter.send(
          { user_id: '123' },
          { content: '', attachments: ['https://cdn.example.com/photo.png?token=secret'] },
          { dryRun: true }
        )
      ).resolves.toEqual({
        dryRun: true,
        success: true,
        receipt: {
          request: {
            method: 'send_msg',
            params: {
              user_id: 123,
              message: [
                remoteAttachmentReceipt('image', 'photo.png', 'image/png', 'cdn.example.com'),
                { type: 'text', data: { text: '' } }
              ]
            }
          }
        }
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      await adapter.destroy();
    }
  });

  it('normalizes decoded remote basenames and rejects control characters', async () => {
    const factory = vi.fn(() => mockClient());
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });

    await expect(
      adapter.send(
        { user_id: '123' },
        {
          content: '',
          attachments: ['https://files.example.com/folder%2Freport.pdf']
        },
        { dryRun: true }
      )
    ).resolves.toEqual({
      dryRun: true,
      success: true,
      receipt: {
        request: {
          method: 'send_msg',
          params: {
            user_id: 123,
            message: [
              remoteAttachmentReceipt('file', 'report.pdf', 'application/pdf', 'files.example.com'),
              { type: 'text', data: { text: '' } }
            ]
          }
        }
      }
    });

    await expect(
      adapter.send(
        { user_id: '123' },
        { content: '', attachments: ['https://files.example.com/%00.pdf'] },
        { dryRun: true }
      )
    ).resolves.toMatchObject({
      dryRun: true,
      success: false,
      error: {
        code: 'INVALID_MESSAGE',
        message: 'Remote attachment filenames must not contain control characters.'
      }
    });
    expect(factory).not.toHaveBeenCalled();
    await adapter.destroy();
  });

  it('rejects unsafe explicit attachment names', async () => {
    const factory = vi.fn(() => mockClient());
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });

    for (const source of ['https://files.example.com/report.pdf', './missing.pdf']) {
      for (const name of [
        '.',
        '..',
        '../report.pdf',
        'folder/report.pdf',
        String.raw`folder\report.pdf`,
        'report\n.pdf'
      ]) {
        await expect(
          adapter.send(
            { user_id: '123' },
            {
              content: [{ type: 'attachment', source, name }]
            },
            { dryRun: true }
          )
        ).resolves.toMatchObject({
          dryRun: true,
          success: false,
          error: {
            code: 'INVALID_MESSAGE',
            message: 'Attachment names must be safe filenames.'
          }
        });
      }
    }
    expect(factory).not.toHaveBeenCalled();
    await adapter.destroy();
  });

  it('rejects unsupported and credentialed remote attachment URLs', async () => {
    const factory = vi.fn(() => mockClient());
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });

    for (const attachment of [
      'ftp://files.example.com/report.pdf',
      'https://',
      'https://user:password@example.com/report.pdf'
    ]) {
      await expect(
        adapter.send(
          { user_id: '123' },
          { content: '', attachments: [attachment] },
          { dryRun: true }
        )
      ).resolves.toMatchObject({
        dryRun: true,
        success: false,
        error: { code: 'INVALID_MESSAGE' }
      });
    }
    expect(factory).not.toHaveBeenCalled();
    await adapter.destroy();
  });

  it('rejects invalid and oversized local attachments before dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pushc-napcat-invalid-'));
    directories.push(root);
    const directory = join(root, 'folder');
    const tooLarge = join(root, 'large.bin');
    await mkdir(directory);
    await writeFile(tooLarge, 'large');
    const factory = vi.fn(() => mockClient());
    const adapter = new NapCatAdapter(
      { base_url: 'ws://localhost:3001', max_attachment_bytes: 4 },
      { factory }
    );

    for (const attachment of [join(root, 'missing.png'), directory, tooLarge]) {
      await expect(
        adapter.send(
          { user_id: '123' },
          { content: '', attachments: [attachment] },
          { dryRun: true }
        )
      ).resolves.toMatchObject({
        dryRun: true,
        success: false,
        error: { code: 'INVALID_MESSAGE' }
      });
    }
    expect(factory).not.toHaveBeenCalled();
    await adapter.destroy();
  });
});

function attachmentReceipt(
  type: 'image' | 'record' | 'video' | 'file',
  name: string,
  mediaType: string,
  contents: string
) {
  return {
    type,
    data: {
      name,
      media_type: mediaType,
      size: Buffer.byteLength(contents),
      sha256: createHash('sha256').update(contents).digest('hex'),
      encoding: 'base64'
    }
  };
}

function attachmentTransport(
  type: 'image' | 'record' | 'video' | 'file',
  contents: string,
  name?: string
) {
  return {
    type,
    data: {
      file: `base64://${Buffer.from(contents).toString('base64')}`,
      ...(name === undefined ? {} : { name })
    }
  };
}

function remoteAttachmentReceipt(
  type: 'image' | 'record' | 'video' | 'file',
  name: string,
  mediaType: string,
  host: string
) {
  return {
    type,
    data: {
      name,
      media_type: mediaType,
      host,
      encoding: 'url'
    }
  };
}

function remoteAttachmentTransport(
  type: 'image' | 'record' | 'video' | 'file',
  url: string,
  name?: string
) {
  return {
    type,
    data: {
      file: url,
      ...(name === undefined ? {} : { name })
    }
  };
}

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
