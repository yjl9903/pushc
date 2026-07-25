import { describe, expect, it, vi } from 'vitest';
import {
  NapCatAdapter,
  parseNapCatConfig,
  parseNapCatTarget,
  type NapCatClient
} from '../src/index.js';

function mockClient(): NapCatClient {
  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    send_msg: vi.fn(async () => ({ message_id: 42 }))
  };
}

describe('napcat adapter', () => {
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
        adapter.send(targetConfig, { message: 'hello', title: 'ignored', param: { x: 'ignored' } })
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

    await expect(adapter.send({ group_id: '123' }, { message: 'hello' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'permission denied' }
    });
    await expect(adapter.send({ group_id: '123' }, { message: 'again' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'NapCat failed to deliver the message.' }
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

    await expect(adapter.send({ user_id: '123' }, { message: 'hello' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: expect.stringContaining('timed out') }
    });
    expect(client.disconnect).not.toHaveBeenCalled();
    await adapter.destroy();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('lazily creates one connection and reuses it across sends', async () => {
    const client = mockClient();
    const factory = vi.fn(() => client);
    const adapter = new NapCatAdapter({ base_url: 'ws://localhost:3001' }, { factory });
    const target = { group_id: '123' };

    expect(factory).not.toHaveBeenCalled();
    await adapter.send(target, { message: 'first' });
    await adapter.send(target, { message: 'second' });

    expect(factory).toHaveBeenCalledOnce();
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.send_msg).toHaveBeenCalledTimes(2);
    expect(client.disconnect).not.toHaveBeenCalled();

    await Promise.all([adapter.destroy(), adapter.destroy()]);
    expect(client.disconnect).toHaveBeenCalledOnce();
    await expect(adapter.send(target, { message: 'after destroy' })).resolves.toMatchObject({
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

    const first = adapter.send(target, { message: 'first' });
    const second = adapter.send(target, { message: 'second' });
    expect(factory).toHaveBeenCalledOnce();
    expect(client.connect).toHaveBeenCalledOnce();
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

    await expect(adapter.send(target, { message: 'first' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'connect failed' }
    });
    await expect(adapter.send(target, { message: 'second' })).resolves.toMatchObject({
      success: true,
      receipt: { response: { messageId: '42' } }
    });

    expect(factory).toHaveBeenCalledTimes(2);
    expect(failedClient.disconnect).toHaveBeenCalledOnce();
    await adapter.destroy();
    expect(connectedClient.disconnect).toHaveBeenCalledOnce();
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
