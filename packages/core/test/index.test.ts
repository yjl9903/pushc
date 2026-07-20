import { describe, expect, it, vi } from 'vitest';
import { PushAdapter, PushClient, PushError, type AdapterSendContext } from '../src/index.js';

interface TestTarget {
  channel: string;
  metadata?: Record<string, unknown>;
}

class MemoryAdapter extends PushAdapter<{ prefix: string }, TestTarget, { id: string }> {
  readonly sendImplementation: (context: AdapterSendContext<TestTarget>) => Promise<{ id: string }>;
  readonly initializeImplementation?: () => Promise<void>;
  readonly destroyImplementation?: () => Promise<void>;
  readonly #defaults: Readonly<Record<string, unknown>>;

  constructor(
    prefix: string,
    defaults: Readonly<Record<string, unknown>> = {},
    options: {
      send?: (context: AdapterSendContext<TestTarget>) => Promise<{ id: string }>;
      initialize?: () => Promise<void>;
      destroy?: () => Promise<void>;
    } = {}
  ) {
    super({ prefix });
    this.#defaults = defaults;
    this.sendImplementation =
      options.send ??
      (async ({ target, message }) => ({ id: `${target.channel}:${message.content}` }));
    this.initializeImplementation = options.initialize;
    this.destroyImplementation = options.destroy;
  }

  parseTarget(input: unknown): TestTarget {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('target must be an object');
    }
    const partial = input as Record<string, unknown>;
    for (const field of Object.keys(partial)) {
      if (field !== 'channel' && field !== 'metadata') {
        throw new Error(`cannot override ${field}`);
      }
    }
    const value = { ...this.#defaults, ...partial };
    if (!('channel' in value)) {
      throw new Error('channel is required');
    }
    return {
      channel: `${this.config.prefix}${String(value.channel)}`,
      ...(value.metadata && typeof value.metadata === 'object'
        ? { metadata: value.metadata as Record<string, unknown> }
        : {})
    };
  }

  protected sendTarget(context: AdapterSendContext<TestTarget>): Promise<{ id: string }> {
    return this.sendImplementation(context);
  }

  async initialize(): Promise<void> {
    await this.initializeImplementation?.();
  }

  async destroy(): Promise<void> {
    await this.destroyImplementation?.();
  }
}

function namedClient(adapter = new MemoryAdapter('#')): PushClient {
  adapter.targets.register('ops', { channel: 'ops' }).register('alerts', { channel: 'alerts' });
  const client = new PushClient();
  client.adapters.register('memory', adapter);
  return client;
}

describe('adapter-owned targets', () => {
  it('provides Map-like APIs and keeps target names scoped to each adapter', () => {
    const first = new MemoryAdapter('#');
    const second = new MemoryAdapter('@');
    first.targets.register('ops', { channel: 'first' });
    second.targets.register('ops', { channel: 'second' });

    expect(first.targets.size).toBe(1);
    expect(first.targets.get('ops')).toEqual({ channel: '#first' });
    expect([...first.targets.keys()]).toEqual(['ops']);
    expect([...first.targets.values()]).toEqual([{ channel: '#first' }]);
    expect([...first.targets]).toEqual([['ops', { channel: '#first' }]]);

    const visited: Array<[string, string]> = [];
    first.targets.forEach((value, key) => visited.push([key, value.channel]));
    expect(visited).toEqual([['ops', '#first']]);
    expect(second.targets.get('ops')).toEqual({ channel: '@second' });
    expect(first.targets.delete('ops')).toBe(true);
    expect(first.targets.size).toBe(0);
  });

  it('resolves generated default, named and temporary targets through adapter send', async () => {
    const adapter = new MemoryAdapter('#', { channel: 'default' });
    adapter.targets.register('ops', { channel: 'ops' });

    await expect(adapter.send({ message: { content: 'default' } })).resolves.toEqual({
      id: '#default:default'
    });
    await expect(adapter.send({ target: 'ops', message: { content: 'named' } })).resolves.toEqual({
      id: '#ops:named'
    });
    await expect(
      adapter.send({ target: { channel: 'preview' }, message: { content: 'temporary' } })
    ).resolves.toEqual({ id: '#preview:temporary' });
    expect([...adapter.targets.keys()]).toEqual(['ops']);
  });

  it('rejects duplicate, invalid-name and forbidden-field registrations', () => {
    const adapter = new MemoryAdapter('');
    adapter.targets.register('ops', { channel: 'ops' });

    expect(() => adapter.targets.register('ops', { channel: 'replacement' })).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_TARGET' })
    );
    expect(() => adapter.targets.register('bad.name', { channel: 'bad' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    );
    expect(() => adapter.targets.register('bad', { connection: 'secret' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    );
    expect(adapter.targets.get('ops')).toEqual({ channel: 'ops' });
  });

  it('shallowly merges target partials with adapter defaults', () => {
    const adapter = new MemoryAdapter('', {
      channel: 'default',
      metadata: { inherited: true, replaced: false }
    });
    adapter.targets.register('ops', { metadata: { replaced: true } });

    expect(adapter.targets.get('ops')).toEqual({
      channel: 'default',
      metadata: { replaced: true }
    });
  });
});

describe('PushClient', () => {
  it('provides a Map-like adapter registry with duplicate protection and destroys removals', async () => {
    const destroy = vi.fn(async () => undefined);
    const client = namedClient(new MemoryAdapter('#', {}, { destroy }));
    const adapter = client.adapters.get('memory');

    expect(client.adapters.size).toBe(1);
    expect(client.adapters.has('memory')).toBe(true);
    expect([...client.adapters.keys()]).toEqual(['memory']);
    expect([...client.adapters.values()]).toEqual([adapter]);
    expect(() => client.adapters.register('memory', new MemoryAdapter(''))).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_ADAPTER' })
    );
    await expect(client.adapters.delete('memory')).resolves.toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(client.adapters.size).toBe(0);
  });

  it('destroys all adapters when clearing the registry', async () => {
    const firstDestroy = vi.fn(async () => undefined);
    const secondDestroy = vi.fn(async () => undefined);
    const client = new PushClient();
    client.adapters
      .register('first', new MemoryAdapter('', {}, { destroy: firstDestroy }))
      .register('second', new MemoryAdapter('', {}, { destroy: secondDestroy }));

    await client.adapters.clear();

    expect(client.adapters.size).toBe(0);
    expect(firstDestroy).toHaveBeenCalledOnce();
    expect(secondDestroy).toHaveBeenCalledOnce();
  });

  it('sends through generated default, named and temporary targets', async () => {
    const adapter = new MemoryAdapter('#', { channel: 'default' });
    const client = namedClient(adapter);

    await expect(
      client.send({ adapter: 'memory', message: { content: 'ready' } })
    ).resolves.toEqual({ adapter: 'memory', receipt: { id: '#default:ready' } });

    await expect(
      client.send({
        adapter: 'memory',
        target: 'ops',
        message: { content: 'ready' }
      })
    ).resolves.toEqual({
      adapter: 'memory',
      target: 'ops',
      receipt: { id: '#ops:ready' }
    });

    await expect(
      client.send({
        adapter: 'memory',
        target: { channel: 'preview' },
        message: { content: 'ready' }
      })
    ).resolves.toEqual({
      adapter: 'memory',
      receipt: { id: '#preview:ready' }
    });
  });

  it('distinguishes missing adapters, targets and invalid input', async () => {
    const client = namedClient();

    await expect(
      client.send({ adapter: 'missing', target: 'ops', message: { content: 'hello' } })
    ).rejects.toMatchObject({ code: 'ADAPTER_NOT_FOUND' });
    await expect(
      client.send({ adapter: 'memory', target: 'missing', message: { content: 'hello' } })
    ).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
    await expect(
      client.send({ adapter: 'memory', target: 'bad.name', message: { content: 'hello' } })
    ).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    await expect(
      client.send({ adapter: 'memory', message: { content: 'hello' } })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    await expect(
      client.send({ adapter: 'bad.name', message: { content: 'hello' } })
    ).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    await expect(
      client.send({ adapter: 'memory', target: 'ops', message: { content: ' ' } })
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
  });

  it('normalizes send failures and respects an aborted signal', async () => {
    const send = vi.fn(async () => {
      throw new Error('offline');
    });
    const adapter = new MemoryAdapter('#', {}, { send });
    const client = namedClient(adapter);

    await expect(
      client.send({ adapter: 'memory', target: 'ops', message: { content: 'hello' } })
    ).rejects.toMatchObject({ code: 'SEND_FAILED', cause: expect.any(Error) });

    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(
      client.send({
        adapter: 'memory',
        target: 'ops',
        message: { content: 'hello' },
        signal: controller.signal
      })
    ).rejects.toBeInstanceOf(PushError);
    expect(send).toHaveBeenCalledOnce();
  });

  it('destroys every adapter once and rejects sends after destruction', async () => {
    const firstDestroy = vi.fn(async () => undefined);
    const secondDestroy = vi.fn(async () => undefined);
    const first = new MemoryAdapter('', { channel: 'first' }, { destroy: firstDestroy });
    const second = new MemoryAdapter('', { channel: 'second' }, { destroy: secondDestroy });
    const client = new PushClient();
    client.adapters.register('first', first).register('second', second);

    await Promise.all([client.destroy(), client.destroy()]);

    expect(firstDestroy).toHaveBeenCalledOnce();
    expect(secondDestroy).toHaveBeenCalledOnce();
    await expect(
      client.send({ adapter: 'first', message: { content: 'hello' } })
    ).rejects.toMatchObject({ code: 'CLIENT_DESTROYED' });
  });

  it('reports destroy failures after attempting every adapter', async () => {
    const successfulDestroy = vi.fn(async () => undefined);
    const failing = new MemoryAdapter(
      '',
      {},
      {
        destroy: async () => {
          throw new Error('close failed');
        }
      }
    );
    const successful = new MemoryAdapter('', {}, { destroy: successfulDestroy });
    const client = new PushClient();
    client.adapters.register('failing', failing).register('successful', successful);

    await expect(client.destroy()).rejects.toMatchObject({
      code: 'DESTROY_FAILED',
      cause: expect.any(Error)
    });
    expect(successfulDestroy).toHaveBeenCalledOnce();
  });
});
