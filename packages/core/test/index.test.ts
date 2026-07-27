import { describe, expect, it, vi } from 'vitest';
import {
  PushAdapter,
  PushClient,
  PushError,
  formatDestination,
  renderTemplate,
  type NormalizedPushPayload,
  type PushAdapterOperationOptions,
  type PushDispatchResult,
  type PushPreparedRequest
} from '../src/index.js';

interface TestTarget {
  readonly channel: string;
}

interface SentCall {
  readonly target: TestTarget;
  readonly payload: NormalizedPushPayload;
  readonly options: PushAdapterOperationOptions;
}

interface TestRequest {
  readonly channel: string;
  readonly message: string;
}

class MemoryAdapter extends PushAdapter<
  { prefix: string },
  TestTarget,
  TestRequest,
  { id: string }
> {
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
    options: PushAdapterOperationOptions
  ) => Promise<PushDispatchResult<TestRequest, { id: string }>>;
  readonly destroyImplementation?: () => Promise<void>;

  constructor(
    prefix = '#',
    readonly defaults: Readonly<Record<string, unknown>> = { channel: 'default' },
    options: {
      send?: (
        request: TestRequest,
        options: PushAdapterOperationOptions
      ) => Promise<PushDispatchResult<TestRequest, { id: string }>>;
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

  protected async prepareRequest(
    target: TestTarget,
    payload: NormalizedPushPayload
  ): Promise<PushPreparedRequest<TestRequest, TestRequest>> {
    const message = payload.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('');
    const request = { channel: target.channel, message };
    this.prepared.set(request, { target, payload });
    return { receiptRequest: request, transportRequest: request };
  }

  protected async dispatchRequest(
    preparedRequest: PushPreparedRequest<TestRequest, TestRequest>,
    options: PushAdapterOperationOptions
  ): Promise<PushDispatchResult<TestRequest, { id: string }>> {
    const transportRequest = preparedRequest.transportRequest;
    const prepared = this.prepared.get(transportRequest);
    if (!prepared) throw new Error('request was not prepared');
    this.contexts.push({ ...prepared, options });
    return (
      (await this.sendImplementation?.(transportRequest, options)) ?? {
        success: true,
        response: { id: `${transportRequest.channel}:${transportRequest.message}` }
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

describe('templates', () => {
  it('scans once, supports fallback, and preserves unknown expressions', () => {
    expect(
      renderTemplate(
        String.raw`{{ message }}|{{title:-alpha:-beta}}|{{param.empty:-x}}|{{param.spaced:-x}}|{{param.inject}}|\{{title}}|{{unknown}}|{{`,
        {
          variables: new Map([
            ['message', '{{title}}'],
            ['title', '']
          ]),
          namespaces: new Map([
            [
              'param',
              new Map([
                ['empty', ''],
                ['spaced', ' '],
                ['inject', '{{message}}']
              ])
            ]
          ])
        }
      )
    ).toBe('{{title}}|alpha:-beta|x| |{{message}}|{{title}}|{{unknown}}|{{');
  });

  it('resolves exact namespace keys and treats missing known values as empty', () => {
    expect(
      renderTemplate('{{title}}|{{param.deploy.group}}|{{param.missing}}|{{other.value}}', {
        variables: new Map([['title', undefined]]),
        namespaces: new Map([['param', new Map([['deploy.group', 'production']])]])
      })
    ).toBe('|production||{{other.value}}');
  });

  it('preserves namespace expressions with invalid keys', () => {
    expect(
      renderTemplate('{{param..name}}|{{param._name:-fallback}}', {
        namespaces: new Map([['param', new Map()]])
      })
    ).toBe('{{param..name}}|{{param._name:-fallback}}');
  });

  it('does not read inherited namespace properties', () => {
    expect(
      renderTemplate('{{param.constructor:-missing}}|{{param.toString:-missing}}', {
        namespaces: new Map([['param', new Map()]])
      })
    ).toBe('missing|missing');
  });
});

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

    await expect(adapter.send(undefined, { content: 'default' })).resolves.toMatchObject({
      success: true,
      receipt: { response: { id: '#default:default' } }
    });
    await expect(adapter.send('ops', { content: 'named' })).resolves.toMatchObject({
      success: true,
      receipt: { response: { id: '#ops:named' } }
    });
    await expect(
      adapter.send({ channel: 'preview' }, { content: 'temporary' })
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
  it('preserves PushError causes', () => {
    const cause = new Error('root cause');
    const error = new PushError('SEND_FAILED', 'failed', { cause });
    expect(error.cause).toBe(cause);
  });

  it('formats default and named destinations', () => {
    expect(formatDestination('webhook')).toBe('webhook');
    expect(formatDestination('webhook', 'ops')).toBe('webhook:ops');
  });

  it('supports string and object destinations with the three-argument API', async () => {
    const client = createClient();

    await expect(client.send('memory', { content: 'default' })).resolves.toMatchInlineSnapshot(`
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
        content: 'ready',
        title: '',
        param: new Map([['deploy.group', 'production']])
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
      client.send({ adapter: 'memory', target: { channel: 'preview' } }, { content: 'test' })
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

  it('normalizes payload and passes operation context without retaining input arrays', async () => {
    const adapter = new MemoryAdapter();
    const param = new Map([
      ['constructor', 'safe'],
      ['channel', 'ops'],
      ['key', 'value']
    ]);
    const attachments = ['photo.png', 'report.pdf'];
    const signal = new AbortController().signal;
    const basePath = '/messages';

    await adapter.send(
      undefined,
      { content: ' hello ', attachments, title: '', param },
      { signal, dryRun: false, basePath }
    );
    attachments.push('later.txt');
    param.set('key', 'changed');

    const context = adapter.contexts[0]!;
    expect(context.payload.content).toEqual([
      { type: 'attachment', source: 'photo.png' },
      { type: 'attachment', source: 'report.pdf' },
      { type: 'text', text: ' hello ' }
    ]);
    expect(context.payload.title).toBe('');
    expect(context.payload.param).toEqual(
      new Map([
        ['constructor', 'safe'],
        ['channel', 'ops'],
        ['key', 'value']
      ])
    );
    expect(context.payload.param).not.toBe(param);
    expect(context.options.signal).toBe(signal);
    expect(context.options.basePath).toBe(basePath);
    expect(context.options).not.toHaveProperty('dryRun');
  });

  it('treats undefined params as omitted', async () => {
    const adapter = new MemoryAdapter();

    await adapter.send(undefined, { content: 'undefined', param: undefined });

    expect(adapter.contexts[0]?.payload).not.toHaveProperty('param');
  });

  it('normalizes string arrays and preserves explicit AST order', async () => {
    const adapter = new MemoryAdapter();
    const ast = [
      { type: 'text' as const, text: 'before' },
      {
        type: 'attachment' as const,
        source: 'report.bin',
        name: 'report.pdf',
        mediaType: 'application/pdf'
      },
      { type: 'text' as const, text: 'after' }
    ];

    await adapter.send(undefined, { content: ['first', 'second'] });
    await adapter.send(undefined, { content: ast });
    ast[0] = { type: 'text', text: 'changed' };

    expect(adapter.contexts[0]?.payload.content).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' }
    ]);
    expect(adapter.contexts[1]?.payload.content).toEqual([
      { type: 'text', text: 'before' },
      {
        type: 'attachment',
        source: 'report.bin',
        name: 'report.pdf',
        mediaType: 'application/pdf'
      },
      { type: 'text', text: 'after' }
    ]);
  });

  it('renders every content input form from title and params', async () => {
    const adapter = new MemoryAdapter();

    await adapter.send(undefined, {
      content: 'Deploy {{param.environment}} as {{title}}',
      attachments: ['reports/{{param.report}}'],
      title: 'release',
      param: new Map([
        ['environment', 'production'],
        ['report', 'summary.pdf']
      ])
    });
    await adapter.send(undefined, {
      content: ['{{param.first}}', '{{param.second}}'],
      param: new Map([
        ['first', 'one'],
        ['second', 'two']
      ])
    });
    await adapter.send(undefined, {
      content: [
        { type: 'text', text: '{{title}}: {{param.status}}' },
        {
          type: 'attachment',
          source: 'reports/{{param.file}}',
          name: '{{param.name}}',
          mediaType: '{{param.media_type}}'
        }
      ],
      title: 'Build',
      param: new Map([
        ['status', 'ready'],
        ['file', 'report.bin'],
        ['name', 'report.pdf'],
        ['media_type', 'application/pdf']
      ])
    });

    expect(adapter.contexts.map(({ payload }) => payload.content)).toEqual([
      [
        { type: 'attachment', source: 'reports/summary.pdf' },
        { type: 'text', text: 'Deploy production as release' }
      ],
      [
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' }
      ],
      [
        { type: 'text', text: 'Build: ready' },
        {
          type: 'attachment',
          source: 'reports/report.bin',
          name: 'report.pdf',
          mediaType: 'application/pdf'
        }
      ]
    ]);
  });

  it('renders content once and leaves message unavailable during normalization', async () => {
    const adapter = new MemoryAdapter();

    await adapter.send(undefined, {
      content: String.raw`\{{title}}|{{param.inject}}|{{message}}`,
      title: 'release',
      param: new Map([['inject', '{{title}}']])
    });

    expect(adapter.contexts[0]?.payload.content).toEqual([
      { type: 'text', text: '{{title}}|{{title}}|{{message}}' }
    ]);
  });

  it.each([
    [{ content: '' }],
    [{ content: '   ' }],
    [{ content: [], attachments: [] }],
    [{ content: '', attachments: [''] }],
    [{ content: '', attachments: [1] }],
    [{ content: 1 }],
    [{ content: 'ok', title: null }],
    [{ content: 'ok', param: 'bad' }],
    [{ content: 'ok', param: [] }],
    [{ content: 'ok', param: { bad: 1 } }],
    [{ content: 'ok', param: { 'bad key': 'value' } }],
    [{ content: 'ok', param: new Map([['bad', 1]]) }],
    [{ content: 'ok', param: new Map([['bad key', 'value']]) }],
    [{ content: 'ok', unknown: true }],
    [{ content: ['ok', { type: 'text', text: 'mixed' }] }],
    [{ content: [{ type: 'napcat:at', qq: 'all' }] }],
    [{ content: [{ type: 'attachment', source: '' }] }],
    [{ content: [{ type: 'attachment', source: 'x', mediaType: 'invalid' }] }],
    [{ content: '{{title}}' }],
    [{ content: '', attachments: ['{{param.missing}}'] }],
    [{ content: [{ type: 'attachment', source: 'x', name: '{{param.missing}}' }] }],
    [{ content: [{ type: 'attachment', source: 'x', mediaType: '{{param.missing}}' }] }],
    [{ content: [{ type: 'text', text: 'ok' }], attachments: [] }]
  ])('rejects invalid payload %#', async (payload) => {
    await expect(new MemoryAdapter().send(undefined, payload as never)).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_MESSAGE' }
    });
  });

  it('treats undefined attachments as omitted', async () => {
    const adapter = new MemoryAdapter();

    await adapter.send(undefined, { content: 'shortcut', attachments: undefined });
    await adapter.send(undefined, {
      content: [{ type: 'text', text: 'ast' }],
      attachments: undefined
    });

    expect(adapter.contexts.map(({ payload }) => payload.content)).toEqual([
      [{ type: 'text', text: 'shortcut' }],
      [{ type: 'text', text: 'ast' }]
    ]);
  });

  it('accepts attachment-only payloads and normalizes empty attachment arrays away', async () => {
    const adapter = new MemoryAdapter();

    await expect(
      adapter.send(undefined, { content: '', attachments: ['photo.png'] })
    ).resolves.toMatchObject({
      success: true,
      receipt: { request: { channel: '#default', message: '' } }
    });
    expect(adapter.contexts[0]?.payload.content).toEqual([
      { type: 'attachment', source: 'photo.png' },
      { type: 'text', text: '' }
    ]);

    await adapter.send(undefined, { content: 'hello', attachments: [] });
    expect(adapter.contexts[1]?.payload.content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('rejects invalid options and pre-cancelled signals before target parsing', async () => {
    const adapter = new MemoryAdapter();
    await expect(
      adapter.send(undefined, { content: 'ok' }, { signal: {} as AbortSignal })
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_SEND_OPTIONS' } });
    await expect(adapter.send(undefined, { content: 'ok' }, null as never)).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_SEND_OPTIONS' }
    });
    await expect(
      adapter.send(undefined, { content: 'ok' }, { unknown: true } as never)
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_SEND_OPTIONS' } });
    await expect(
      adapter.send(undefined, { content: 'ok' }, { dryRun: 'true' } as never)
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_SEND_OPTIONS' } });
    await expect(
      adapter.send(undefined, { content: 'ok' }, { basePath: '' })
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_SEND_OPTIONS' } });
    await expect(
      adapter.send(undefined, { content: 'ok' }, {
        basePath: new URL('file:///messages')
      } as never)
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_SEND_OPTIONS' } });

    const reason = new Error('cancelled');
    const controller = new AbortController();
    controller.abort(reason);
    adapter.parse.mockClear();
    await expect(
      adapter.send(undefined, { content: 'ok' }, { signal: controller.signal })
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'Message sending was aborted.' }
    });
    expect(adapter.parse).not.toHaveBeenCalled();
  });

  it('preserves prepared requests when cancellation prevents dispatch', async () => {
    const adapter = new MemoryAdapter();
    const sendController = new AbortController();
    const sending = adapter.send(undefined, { content: 'send' }, { signal: sendController.signal });
    sendController.abort(new Error('cancelled after preparation'));

    await expect(sending).resolves.toEqual({
      success: false,
      receipt: {
        request: {
          channel: '#default',
          message: 'send'
        }
      },
      error: {
        code: 'SEND_FAILED',
        message: 'Message sending was aborted.'
      }
    });

    const dryRunController = new AbortController();
    const preparing = adapter.send(
      undefined,
      { content: 'dry-run' },
      { dryRun: true, signal: dryRunController.signal }
    );
    dryRunController.abort(new Error('cancelled after preparation'));

    await expect(preparing).resolves.toEqual({
      dryRun: true,
      success: false,
      receipt: {
        request: {
          channel: '#default',
          message: 'dry-run'
        }
      },
      error: {
        code: 'SEND_FAILED',
        message: 'Message sending was aborted.'
      }
    });
    expect(adapter.contexts).toEqual([]);
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
    const result = await createClient().send(destination as never, { content: 'ok' });
    expect(result).toMatchObject({ success: false, error: { code: 'INVALID_TARGET' } });
    expect(result).not.toHaveProperty('adapter');
    expect(result).not.toHaveProperty('target');
  });

  it('distinguishes missing adapters and normalizes concrete failures', async () => {
    await expect(createClient().send('missing', { content: 'ok' })).resolves.toMatchObject({
      success: false,
      adapter: 'missing',
      error: { code: 'ADAPTER_NOT_FOUND' }
    });

    await expect(createClient().send('memory:missing', { content: 'ok' })).resolves.toEqual({
      success: false,
      adapter: 'memory',
      target: 'missing',
      error: {
        code: 'TARGET_NOT_FOUND',
        message: 'Target "missing" is not defined.'
      }
    });

    await expect(createClient().send('memory:ops', { content: '' })).resolves.toEqual({
      success: false,
      adapter: 'memory',
      target: 'ops',
      error: {
        code: 'INVALID_MESSAGE',
        message: 'Invalid push payload.'
      }
    });

    const failure = new Error('offline');
    const adapter = new MemoryAdapter(
      '#',
      {},
      {
        send: async () => Promise.reject(failure)
      }
    );
    await expect(
      createClient(adapter).send('memory:ops', { content: 'ok' })
    ).resolves.toMatchObject({
      success: false,
      adapter: 'memory',
      target: 'ops',
      error: { code: 'SEND_FAILED', message: 'offline' }
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
          error: { code: 'SEND_FAILED', message: 'offline' }
        })
      }
    );
    await expect(
      createClient(adapterFailure).send('memory:ops', { content: 'hello' })
    ).resolves.toEqual({
      success: false,
      adapter: 'memory',
      target: 'ops',
      receipt: { request },
      error: { code: 'SEND_FAILED', message: 'offline' }
    });

    const unexpected = new MemoryAdapter();
    await expect(
      createClient(
        new MemoryAdapter('#', {}, { send: async () => Promise.reject(new Error('unexpected')) })
      ).send('memory:ops', { content: 'hello' })
    ).resolves.toEqual({
      success: false,
      adapter: 'memory',
      target: 'ops',
      receipt: { request: { channel: '#ops', message: 'hello' } },
      error: { code: 'SEND_FAILED', message: 'unexpected' }
    });
  });

  it('uses a receipt request finalized during dispatch', async () => {
    const adapter = new MemoryAdapter(
      '#',
      {},
      {
        send: async (request) => ({
          success: true,
          request: { ...request, message: 'finalized' },
          response: { id: 'sent' }
        })
      }
    );

    await expect(createClient(adapter).send('memory:ops', { content: 'initial' })).resolves.toEqual(
      {
        success: true,
        adapter: 'memory',
        target: 'ops',
        receipt: {
          request: { channel: '#ops', message: 'finalized' },
          response: { id: 'sent' }
        }
      }
    );
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

    await expect(client.send('memory', { content: 'hello' })).resolves.toEqual({
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
        { content: 'hello' }
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
      adapter.send(undefined, { content: 'default' }, { dryRun: true })
    ).resolves.toEqual({
      dryRun: true,
      success: true,
      receipt: { request: { channel: '#default', message: 'default' } }
    });
    await expect(adapter.send('ops', { content: 'named' }, { dryRun: true })).resolves.toEqual({
      dryRun: true,
      success: true,
      receipt: { request: { channel: '#ops', message: 'named' } }
    });
    await expect(
      adapter.send({ channel: 'temporary' }, { content: 'preview' }, { dryRun: true })
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
      client.send('memory:ops', { content: 'hello' }, { dryRun: true })
    ).resolves.toEqual({
      dryRun: true,
      success: true,
      adapter: 'memory',
      target: 'ops',
      receipt: { request: { channel: '#ops', message: 'hello' } }
    });
    await expect(
      client.send('memory:missing', { content: 'hello' }, { dryRun: true })
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
      client.send('missing', { content: 'hello' }, { dryRun: true })
    ).resolves.toMatchObject({
      dryRun: true,
      success: false,
      adapter: 'missing',
      error: { code: 'ADAPTER_NOT_FOUND' }
    });
    await expect(
      client.send('bad.name', { content: 'hello' }, { dryRun: true })
    ).resolves.toMatchObject({
      dryRun: true,
      success: false,
      error: { code: 'INVALID_TARGET' }
    });
    await expect(
      client.send('memory', { content: '   ' }, { dryRun: true })
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
    await expect(client.send('memory', { content: 'hello' }, { dryRun: true })).resolves.toEqual({
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
    await expect(client.send('memory', { content: 'ok' })).resolves.toMatchObject({
      success: false,
      error: { code: 'CLIENT_DESTROYED' }
    });

    const destroyError = new Error('failed');
    const failing = new PushClient();
    failing.adapters.register(
      'memory',
      new MemoryAdapter('#', {}, { destroy: async () => Promise.reject(destroyError) })
    );
    await expect(failing.destroy()).rejects.toMatchObject({
      code: 'DESTROY_FAILED',
      cause: destroyError
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
