import { describe, expect, it, vi } from 'vitest';
import {
  PushAdapter,
  PushClient,
  PushError,
  formatDestination,
  type PushAdapterSendResult,
  type PushPayload,
  type PushReceipt,
  type PushSendOptions
} from '../src/index.js';

interface TestTarget {
  readonly channel: string;
}

interface SentCall {
  readonly target: TestTarget;
  readonly payload: PushPayload;
  readonly options: Readonly<PushSendOptions>;
}

interface TestRequest {
  readonly channel: string;
  readonly message: string;
}

type TestReceipt = PushReceipt<TestRequest, { id: string }>;

class MemoryAdapter extends PushAdapter<{ prefix: string }, TestTarget, TestReceipt> {
  readonly contexts: SentCall[] = [];
  readonly prepared = new WeakMap<TestRequest, Omit<SentCall, 'options'>>();
  readonly parse = vi.fn((input: unknown): TestTarget => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new Error('target must be an object');
    }
    const value = { ...this.defaults, ...(input as Record<string, unknown>) };
    if (typeof value.channel !== 'string') throw new Error('channel is required');
    return { channel: `${this.config.prefix}${value.channel}` };
  });
  readonly sendImplementation?: (
    request: TestRequest,
    options: Readonly<PushSendOptions>
  ) => Promise<PushAdapterSendResult<TestReceipt>>;
  readonly destroyImplementation?: () => Promise<void>;

  constructor(
    prefix = '#',
    readonly defaults: Readonly<Record<string, unknown>> = { channel: 'default' },
    options: {
      send?: (
        request: TestRequest,
        options: Readonly<PushSendOptions>
      ) => Promise<PushAdapterSendResult<TestReceipt>>;
      destroy?: () => Promise<void>;
    } = {}
  ) {
    super({ prefix });
    this.sendImplementation = options.send;
    this.destroyImplementation = options.destroy;
  }

  parseTarget(input: unknown): TestTarget {
    return this.parse(input);
  }

  protected prepareRequest(target: TestTarget, payload: PushPayload): TestRequest {
    const request = { channel: target.channel, message: payload.message };
    this.prepared.set(request, { target, payload });
    return request;
  }

  protected async sendRequest(
    request: TestRequest,
    options: Readonly<PushSendOptions>
  ): Promise<PushAdapterSendResult<TestReceipt>> {
    const prepared = this.prepared.get(request);
    if (!prepared) throw new Error('request was not prepared');
    this.contexts.push({ ...prepared, options });
    return (
      (await this.sendImplementation?.(request, options)) ?? {
        success: true,
        receipt: {
          request,
          response: { id: `${request.channel}:${request.message}` }
        }
      }
    );
  }

  async destroy(): Promise<void> {
    await this.destroyImplementation?.();
  }
}

function createClient(adapter = new MemoryAdapter()): PushClient {
  adapter.targets.register('ops', { channel: 'ops' });
  const client = new PushClient();
  client.adapters.register('memory', adapter);
  return client;
}

describe('PushTargets', () => {
  it('stores resolved targets and provides Map-like APIs', () => {
    const adapter = new MemoryAdapter();
    adapter.targets.register('ops', { channel: 'ops' });
    expect(adapter.targets.size).toBe(1);
    expect(adapter.targets.get('ops')).toMatchInlineSnapshot(`
      {
        "channel": "#ops",
      }
    `);
    expect([...adapter.targets]).toMatchInlineSnapshot(`
      [
        [
          "ops",
          {
            "channel": "#ops",
          },
        ],
      ]
    `);
    expect([...adapter.targets.keys()]).toMatchInlineSnapshot(`
      [
        "ops",
      ]
    `);
    expect([...adapter.targets.values()]).toMatchInlineSnapshot(`
      [
        {
          "channel": "#ops",
        },
      ]
    `);

    const visited: string[] = [];
    adapter.targets.forEach((target, name) => visited.push(`${name}:${target.channel}`));
    expect(visited).toMatchInlineSnapshot(`
      [
        "ops:#ops",
      ]
    `);
    expect(adapter.targets.delete('ops')).toBe(true);
    expect(adapter.targets.size).toBe(0);
  });

  it('resolves default, named and temporary target inputs', async () => {
    const adapter = new MemoryAdapter();
    adapter.targets.register('ops', { channel: 'ops' });

    await expect(adapter.send(undefined, { message: 'default' })).resolves.toMatchObject({
      success: true,
      receipt: { response: { id: '#default:default' } }
    });
    await expect(adapter.send('ops', { message: 'named' })).resolves.toMatchObject({
      success: true,
      receipt: { response: { id: '#ops:named' } }
    });
    await expect(
      adapter.send({ channel: 'preview' }, { message: 'temporary' })
    ).resolves.toMatchObject({
      success: true,
      receipt: { response: { id: '#preview:temporary' } }
    });
    expect([...adapter.targets.keys()]).toMatchInlineSnapshot(`
      [
        "ops",
      ]
    `);
  });

  it('rejects duplicate, invalid and unknown targets', () => {
    const adapter = new MemoryAdapter();
    adapter.targets.register('ops', { channel: 'ops' });
    expect(captureError(() => adapter.targets.register('ops', { channel: 'again' })))
      .toMatchInlineSnapshot(`
      {
        "code": "DUPLICATE_TARGET",
        "message": "Target "ops" is already registered.",
        "name": "PushError",
      }
    `);
    expect(captureError(() => adapter.targets.register('bad.name', {}))).toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Target names must start with a letter or digit and use only letters, digits, _ or -.",
        "name": "PushError",
      }
    `);
    expect(captureError(() => adapter.targets.resolve('missing'))).toMatchInlineSnapshot(`
      {
        "code": "TARGET_NOT_FOUND",
        "message": "Target "missing" is not defined.",
        "name": "PushError",
      }
    `);
    expect(captureError(() => adapter.targets.resolve('bad.name'))).toMatchInlineSnapshot(`
      {
        "code": "INVALID_TARGET",
        "message": "Target names must use only letters, digits, _ or -.",
        "name": "PushError",
      }
    `);
  });
});

describe('send boundaries', () => {
  it.each([0, false, '', null])('preserves falsy PushError causes %#', (cause) => {
    const error = new PushError('SEND_FAILED', 'failed', { cause });
    expect(error.cause).toBe(cause);
  });

  it('formats default and named destinations', () => {
    expect(formatDestination('webhook')).toBe('webhook');
    expect(formatDestination('webhook', 'ops')).toBe('webhook:ops');
  });

  it('supports string and object destinations with the three-argument API', async () => {
    const client = createClient();

    await expect(client.send('memory', { message: 'default' })).resolves.toMatchInlineSnapshot(`
      {
        "adapter": "memory",
        "receipt": {
          "request": {
            "channel": "#default",
            "message": "default",
          },
          "response": {
            "id": "#default:default",
          },
        },
        "success": true,
      }
    `);
    await expect(
      client.send('memory:ops', {
        message: 'ready',
        title: '',
        param: { 'deploy.group': 'production' }
      })
    ).resolves.toMatchInlineSnapshot(`
      {
        "adapter": "memory",
        "receipt": {
          "request": {
            "channel": "#ops",
            "message": "ready",
          },
          "response": {
            "id": "#ops:ready",
          },
        },
        "success": true,
        "target": "ops",
      }
    `);
    await expect(
      client.send({ adapter: 'memory', target: { channel: 'preview' } }, { message: 'test' })
    ).resolves.toMatchInlineSnapshot(`
      {
        "adapter": "memory",
        "receipt": {
          "request": {
            "channel": "#preview",
            "message": "test",
          },
          "response": {
            "id": "#preview:test",
          },
        },
        "success": true,
      }
    `);
  });

  it('copies payload safely and preserves signal identity', async () => {
    const adapter = new MemoryAdapter();
    const param = { constructor: 'safe', key: 'value' };
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as AbortSignal;

    await adapter.send(
      undefined,
      { message: ' hello ', title: '', param },
      { signal, dryRun: false }
    );

    const context = adapter.contexts[0]!;
    expect(context.payload.message).toBe(' hello ');
    expect(context.payload.title).toBe('');
    expect(context.payload.param).toMatchInlineSnapshot(`
      {
        "constructor": "safe",
        "key": "value",
      }
    `);
    expect(Object.getPrototypeOf(context.payload.param)).toBeNull();
    expect(Object.isFrozen(context.payload.param)).toBe(true);
    expect(context.options.signal).toBe(signal);
    expect(context.options.dryRun).toBe(false);
    expect(Object.isFrozen(context.options)).toBe(true);
  });

  it.each([
    [{ message: '' }],
    [{ message: '   ' }],
    [{ message: 1 }],
    [{ message: 'ok', title: null }],
    [{ message: 'ok', param: [] }],
    [{ message: 'ok', param: { bad: 1 } }],
    [{ message: 'ok', param: { 'bad key': 'value' } }],
    [{ message: 'ok', unknown: true }],
    [JSON.parse('{"message":"ok","__proto__":true}')],
    [{ message: 'ok', param: JSON.parse('{"__proto__":"value"}') }]
  ])('rejects invalid payload %#', async (payload) => {
    await expect(new MemoryAdapter().send(undefined, payload as never)).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_MESSAGE' }
    });
  });

  it('rejects invalid options and pre-cancelled signals before target parsing', async () => {
    const adapter = new MemoryAdapter();
    await expect(
      adapter.send(undefined, { message: 'ok' }, { signal: {} as AbortSignal })
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_SEND_OPTIONS' } });
    await expect(adapter.send(undefined, { message: 'ok' }, null as never)).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_SEND_OPTIONS' }
    });
    await expect(
      adapter.send(undefined, { message: 'ok' }, { unknown: true } as never)
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_SEND_OPTIONS' } });
    await expect(
      adapter.send(undefined, { message: 'ok' }, JSON.parse('{"__proto__":true}') as never)
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_SEND_OPTIONS' } });
    await expect(
      adapter.send(undefined, { message: 'ok' }, { dryRun: 'true' } as never)
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_SEND_OPTIONS' } });

    const reason = new Error('cancelled');
    const signal = {
      aborted: true,
      reason,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as AbortSignal;
    adapter.parse.mockClear();
    await expect(adapter.send(undefined, { message: 'ok' }, { signal })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'Message sending was aborted.' }
    });
    expect(adapter.parse).not.toHaveBeenCalled();
  });

  it.each([
    '',
    ':ops',
    'memory:',
    'memory:ops:extra',
    'bad.name',
    { adapter: 'memory', extra: true },
    { adapter: 'memory', target: [] }
  ])('rejects invalid destination %#', async (destination) => {
    const result = await createClient().send(destination as never, { message: 'ok' });
    expect(result).toMatchObject({ success: false, error: { code: 'INVALID_TARGET' } });
    expect(result).not.toHaveProperty('adapter');
    expect(result).not.toHaveProperty('target');
  });

  it('distinguishes missing adapters and normalizes concrete failures', async () => {
    await expect(createClient().send('missing', { message: 'ok' })).resolves.toMatchObject({
      success: false,
      adapter: 'missing',
      error: { code: 'ADAPTER_NOT_FOUND' }
    });

    await expect(createClient().send('memory:missing', { message: 'ok' })).resolves.toEqual({
      success: false,
      adapter: 'memory',
      target: 'missing',
      error: {
        code: 'TARGET_NOT_FOUND',
        message: 'Target "missing" is not defined.'
      }
    });

    await expect(createClient().send('memory:ops', { message: '' })).resolves.toEqual({
      success: false,
      adapter: 'memory',
      target: 'ops',
      error: {
        code: 'INVALID_MESSAGE',
        message: 'Invalid push payload.'
      }
    });

    const failure = { message: 'offline', status: 503 };
    const adapter = new MemoryAdapter(
      '#',
      {},
      {
        send: async () => Promise.reject(failure)
      }
    );
    await expect(
      createClient(adapter).send('memory:ops', { message: 'ok' })
    ).resolves.toMatchObject({
      success: false,
      adapter: 'memory',
      target: 'ops',
      error: { code: 'SEND_FAILED' }
    });
  });

  it('merges adapter failures and normalizes unexpected adapter exceptions', async () => {
    const request = { channel: '#ops', message: 'hello' };
    const adapterFailure = new MemoryAdapter(
      '#',
      {},
      {
        send: async () => ({
          success: false,
          receipt: { request },
          error: { code: 'SEND_FAILED', message: 'offline' }
        })
      }
    );
    await expect(
      createClient(adapterFailure).send('memory:ops', { message: 'hello' })
    ).resolves.toEqual({
      success: false,
      adapter: 'memory',
      target: 'ops',
      receipt: { request },
      error: { code: 'SEND_FAILED', message: 'offline' }
    });

    const unexpected = new MemoryAdapter();
    vi.spyOn(unexpected, 'send').mockRejectedValue(new Error('unexpected failure'));
    await expect(
      createClient(unexpected).send('memory:ops', { message: 'hello' })
    ).resolves.toEqual({
      success: false,
      adapter: 'memory',
      target: 'ops',
      error: { code: 'SEND_FAILED', message: 'unexpected failure' }
    });
  });

  it('only forwards fields defined by the public result contract', async () => {
    const receipt = {
      request: {
        channel: '#default',
        message: 'hello'
      }
    };
    const adapter = new MemoryAdapter();
    const send = vi.spyOn(adapter, 'send');
    send
      .mockResolvedValueOnce({
        success: true,
        receipt,
        target: 'injected',
        extra: 'leak'
      } as never)
      .mockResolvedValueOnce({
        success: false,
        receipt,
        target: 'injected',
        extra: 'leak',
        error: {
          code: 'SEND_FAILED',
          message: 'offline',
          cause: 'hidden'
        }
      } as never);
    const client = createClient(adapter);

    await expect(client.send('memory', { message: 'hello' })).resolves.toEqual({
      success: true,
      adapter: 'memory',
      receipt
    });
    await expect(
      client.send(
        {
          adapter: 'memory',
          target: {
            channel: '#preview'
          }
        },
        { message: 'hello' }
      )
    ).resolves.toEqual({
      success: false,
      adapter: 'memory',
      receipt,
      error: {
        code: 'SEND_FAILED',
        message: 'offline'
      }
    });
  });
});

describe('dry-run send boundaries', () => {
  it('prepares default, named and temporary requests without sending', async () => {
    const adapter = new MemoryAdapter();
    adapter.targets.register('ops', { channel: 'ops' });

    await expect(
      adapter.send(undefined, { message: 'default' }, { dryRun: true })
    ).resolves.toEqual({
      dryRun: true,
      success: true,
      receipt: { request: { channel: '#default', message: 'default' } }
    });
    await expect(adapter.send('ops', { message: 'named' }, { dryRun: true })).resolves.toEqual({
      dryRun: true,
      success: true,
      receipt: { request: { channel: '#ops', message: 'named' } }
    });
    await expect(
      adapter.send({ channel: 'temporary' }, { message: 'preview' }, { dryRun: true })
    ).resolves.toEqual({
      dryRun: true,
      success: true,
      receipt: { request: { channel: '#temporary', message: 'preview' } }
    });
    expect(adapter.contexts).toEqual([]);
  });

  it('adds destination context and preserves dry-run failures', async () => {
    const client = createClient();
    await expect(
      client.send('memory:ops', { message: 'hello' }, { dryRun: true })
    ).resolves.toEqual({
      dryRun: true,
      success: true,
      adapter: 'memory',
      target: 'ops',
      receipt: { request: { channel: '#ops', message: 'hello' } }
    });
    await expect(
      client.send('memory:missing', { message: 'hello' }, { dryRun: true })
    ).resolves.toEqual({
      dryRun: true,
      success: false,
      adapter: 'memory',
      target: 'missing',
      error: {
        code: 'TARGET_NOT_FOUND',
        message: 'Target "missing" is not defined.'
      }
    });
    await expect(
      client.send('missing', { message: 'hello' }, { dryRun: true })
    ).resolves.toMatchObject({
      dryRun: true,
      success: false,
      adapter: 'missing',
      error: { code: 'ADAPTER_NOT_FOUND' }
    });
    await expect(
      client.send('bad.name', { message: 'hello' }, { dryRun: true })
    ).resolves.toMatchObject({
      dryRun: true,
      success: false,
      error: { code: 'INVALID_TARGET' }
    });
    await expect(
      client.send('memory', { message: '   ' }, { dryRun: true })
    ).resolves.toMatchObject({
      dryRun: true,
      success: false,
      adapter: 'memory',
      error: { code: 'INVALID_MESSAGE' }
    });
  });

  it('rejects dry runs after client destruction', async () => {
    const client = createClient();
    await client.destroy();
    await expect(client.send('memory', { message: 'hello' }, { dryRun: true })).resolves.toEqual({
      dryRun: true,
      success: false,
      error: {
        code: 'CLIENT_DESTROYED',
        message: 'PushClient has been destroyed.'
      }
    });
  });
});

describe('adapter registry lifecycle', () => {
  it('protects duplicates and destroys deleted adapters', async () => {
    const destroy = vi.fn(async () => undefined);
    const adapter = new MemoryAdapter('#', {}, { destroy });
    const client = new PushClient();
    client.adapters.register('memory', adapter);
    expect(captureError(() => client.adapters.register('memory', new MemoryAdapter())))
      .toMatchInlineSnapshot(`
      {
        "code": "DUPLICATE_ADAPTER",
        "message": "Adapter "memory" is already registered.",
        "name": "PushError",
      }
    `);
    await expect(client.adapters.delete('memory')).resolves.toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('destroys once, reports failures, and rejects later sends', async () => {
    const destroy = vi.fn(async () => undefined);
    const client = createClient(new MemoryAdapter('#', {}, { destroy }));
    await Promise.all([client.destroy(), client.destroy()]);
    expect(destroy).toHaveBeenCalledOnce();
    await expect(client.send('memory', { message: 'ok' })).resolves.toMatchObject({
      success: false,
      error: { code: 'CLIENT_DESTROYED' }
    });

    const failing = new PushClient();
    failing.adapters.register(
      'memory',
      new MemoryAdapter('#', {}, { destroy: async () => Promise.reject('failed') })
    );
    await expect(failing.destroy()).rejects.toMatchObject({
      code: 'DESTROY_FAILED',
      cause: 'failed'
    });
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
