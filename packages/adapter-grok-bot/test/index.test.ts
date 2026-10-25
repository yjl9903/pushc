import { PushError, type PushPayload } from '@pushc/core';
import { describe, expect, it, vi } from 'vitest';
import { GrokBotAdapter } from '../src/index.js';

const connection = { url: 'https://example.com/routine', key: 'test-key' };
function okFetch() {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }));
}

describe('Grok Bot configuration', () => {
  it('normalizes defaults and supports default, named and temporary targets', async () => {
    const fetch = okFetch();
    const adapter = new GrokBotAdapter(connection, { fetch });
    expect(adapter.config).toEqual({
      ...connection,
      timeout_ms: 10000,
      content_type: 'application/json'
    });
    expect(adapter.targets.resolve()).toEqual(adapter.config);
    adapter.targets.register('research', {
      url: 'https://example.com/research',
      key: 'research-key',
      timeout_ms: 50
    });
    await adapter.send('research', { content: 'hello' });
    expect(fetch.mock.calls[0]).toEqual([
      'https://example.com/research',
      expect.objectContaining({
        method: 'POST',
        body: '{"message":"hello"}',
        headers: { authorization: 'Bearer research-key', 'content-type': 'application/json' },
        signal: expect.any(AbortSignal)
      })
    ]);
    const result = await adapter.send({ timeout_ms: 100 }, { content: 'hello' }, { dryRun: true });
    expect(result.receipt?.request).toMatchObject({ url: connection.url, timeout_ms: 100 });
    expect(adapter.config.key).toBe('test-key');
  });

  it.each([
    {},
    { url: connection.url },
    { ...connection, extra: true },
    { ...connection, url: 'http://example.com/routine' },
    { ...connection, url: 'https://user:password@example.com/routine' },
    { ...connection, url: 'https://example.com/{{param.path}}' },
    { ...connection, url: 'invalid' },
    ...['', 'Bearer token', 'bearer token', ' key', 'key\n', 'key\u007f', '{{param.key}}'].map(
      (key) => ({ ...connection, key })
    ),
    ...[0, -1, 0.5, 2147483648].map((timeout_ms) => ({ ...connection, timeout_ms })),
    { ...connection, content_type: 'application/xml' },
    { ...connection, content_type: 'text/plain', body: {} },
    { ...connection, body: new Date() },
    { ...connection, body: { invalid: undefined } }
  ])('rejects invalid config without exposing input: %#', (config) => {
    try {
      new GrokBotAdapter(config);
      expect.fail('Expected invalid config');
    } catch (error) {
      expect(error).toBeInstanceOf(PushError);
      expect(error).toMatchObject({
        code: 'INVALID_CONFIG',
        message: 'Invalid Grok Bot configuration.'
      });
    }
  });

  it.each([
    { url: 'https://example.com/other' },
    { key: 'other-key' },
    { url: 'https://other.example.com/routine', key: 'other-key' },
    { url: 'http://example.com/routine', key: 'other-key' },
    { url: 'https://example.com/{{title}}', key: 'other-key' },
    { url: 'https://example.com/other', key: 'Bearer token' },
    { response: { status: 202 } },
    { timeout_ms: 0 },
    { body: { invalid: new Date() } },
    { content_type: 'text/plain', body: [] }
  ])('rejects invalid targets during registration and send: %#', async (target) => {
    const fetch = okFetch();
    const adapter = new GrokBotAdapter(connection, { fetch });
    expect(() => adapter.targets.register('bad', target)).toThrow(
      'Invalid Grok Bot configuration.'
    );
    const result = await adapter.send(target, { content: 'hello' });
    expect(result).toEqual({
      success: false,
      error: { code: 'INVALID_CONFIG', message: 'Invalid Grok Bot configuration.' }
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Grok Bot body mapping', () => {
  it('renders content once, concatenates nodes and preserves literal values and flat param keys', async () => {
    const fetch = okFetch();
    const adapter = new GrokBotAdapter(connection, { fetch });
    const param = new Map([
      ['a.b', '42'],
      ['literal', '{{title}}'],
      ['empty', '']
    ]);
    const result = await adapter.send(undefined, {
      content: [
        { type: 'text', text: '"first"\n' },
        { type: 'text', text: '{{param.literal}} \\{{title}} {{message}}' }
      ],
      title: '{{param.a.b}}',
      param
    });
    const expected = {
      message: '"first"\n{{title}} {{title}} {{message}}',
      title: '{{param.a.b}}',
      param: Object.fromEntries(param)
    };
    expect(result.receipt?.request.body).toEqual(expected);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(expected));
    expect(result.receipt?.summary).toBe('Grok Bot routine triggered (HTTP 200).');
  });

  it.each([
    [{ content: 'hello' }, { message: 'hello' }],
    [
      { content: ['one', 'two'], title: '', param: new Map() },
      { message: 'onetwo', title: '', param: {} }
    ]
  ] satisfies [PushPayload, unknown][])(
    'preserves metadata presence: %#',
    async (payload, expected) => {
      const adapter = new GrokBotAdapter(connection, { fetch: okFetch() });
      const result = await adapter.send(undefined, payload, { dryRun: true });
      expect(result.receipt?.request.body).toEqual(expected);
    }
  );

  it.each(
    [{}, [], '', false, true, 0, 42, null, 'hello', ['a', 1, null]].map((body) => ({ body }))
  )('keeps explicit JSON bodies without adding default fields: %#', async ({ body }) => {
    for (const configuredAt of ['adapter', 'target']) {
      const fetch = okFetch();
      const adapter = new GrokBotAdapter(
        { ...connection, ...(configuredAt === 'adapter' ? { body } : {}) },
        { fetch }
      );
      const result = await adapter.send(configuredAt === 'target' ? { body } : undefined, {
        content: 'message',
        title: 'title',
        param: new Map([['event', 'test']])
      });
      expect(result.success).toBe(true);
      expect(result.receipt?.request.body).toEqual(body);
      expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(body));
    }
  });

  it('renders custom nested templates, fallback and escapes without interpreting keys or JSON strings', async () => {
    const adapter = new GrokBotAdapter(
      {
        ...connection,
        body: {
          '{{title}}': [
            '{{message}}',
            '{{title:-fallback}}',
            '{{param.missing:-default}}',
            '\\{{title}}'
          ],
          nested: { number: 1, boolean: false, nothing: null, string: '{{param.json}}' }
        }
      },
      { fetch: okFetch() }
    );
    const result = await adapter.send(
      undefined,
      {
        content: '{{param.literal}}',
        param: new Map([
          ['literal', '{{title}}'],
          ['json', '{"n":2}']
        ])
      },
      { dryRun: true }
    );
    expect(result.receipt?.request.body).toEqual({
      '{{title}}': ['{{title}}', 'fallback', 'default', '{{title}}'],
      nested: { number: 1, boolean: false, nothing: null, string: '{"n":2}' }
    });
  });

  it('shallow merges only explicit objects, replaces other bodies and does not mutate defaults', async () => {
    const body = { keep: true, nested: { old: true }, message: 'base' };
    const adapter = new GrokBotAdapter({ ...connection, body });
    const target = { body: { nested: { new: true }, task: '{{message}}' } };
    const result = await adapter.send(target, { content: 'hello' }, { dryRun: true });
    expect(result.receipt?.request.body).toEqual({
      keep: true,
      nested: { new: true },
      message: 'base',
      task: 'hello'
    });
    expect(adapter.parseTarget({ body: {} }).body).toEqual(body);
    expect(adapter.parseTarget({ body: null }).body).toBeNull();
    expect(adapter.parseTarget({ body: [] }).body).toEqual([]);
    expect(adapter.parseTarget({ body: 'replacement' }).body).toBe('replacement');
    expect(
      new GrokBotAdapter({ ...connection, body: [] }).parseTarget({ body: { task: 'new' } }).body
    ).toEqual({ task: 'new' });
    expect(adapter.config.body).toEqual(body);
    expect(target.body.task).toBe('{{message}}');
    const targetOnly = await new GrokBotAdapter(connection).send(
      { body: { task: '{{message}}' } },
      { content: 'hello' },
      { dryRun: true }
    );
    expect(targetOnly.receipt?.request.body).toEqual({ task: 'hello' });
  });

  it.each([
    [{ content_type: 'text/plain' }, undefined, 'hello'],
    [
      { content_type: 'Text/Plain; Charset=UTF-8', body: '{{title}}: {{message}}' },
      undefined,
      'title: hello'
    ],
    [{}, { content_type: 'text/plain', body: '{{message}}' }, 'hello'],
    [{ body: '{{message}}' }, undefined, '"hello"']
  ])('uses text or JSON serialization: %#', async (config, target, expected) => {
    const fetch = okFetch();
    const adapter = new GrokBotAdapter({ ...connection, ...config }, { fetch });
    const result = await adapter.send(target, { content: 'hello', title: 'title' });
    expect(result.success).toBe(true);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(expected);
  });

  it('validates inherited body against a target content type override', async () => {
    const fetch = okFetch();
    const adapter = new GrokBotAdapter({ ...connection, body: { task: 'hello' } }, { fetch });
    expect(() => adapter.targets.register('text', { content_type: 'text/plain' })).toThrow(
      'Invalid Grok Bot configuration.'
    );
    const result = await adapter.send({ content_type: 'text/plain' }, { content: 'hello' });
    expect(result).toMatchObject({ success: false, error: { code: 'INVALID_CONFIG' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects attachments and invalid content before transport, even with custom body', async () => {
    const fetch = okFetch();
    const adapter = new GrokBotAdapter({ ...connection, body: { task: 'constant' } }, { fetch });
    for (const payload of [{ content: 'hello', attachments: ['file.txt'] }, { content: '' }]) {
      expect(await adapter.send(undefined, payload)).toMatchObject({
        success: false,
        error: { code: 'INVALID_MESSAGE' }
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Grok Bot dispatch', () => {
  it.each([200, 201, 202, 204, 401, 429, 500])('accepts only HTTP 200: %s', async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
    const result = await new GrokBotAdapter(connection, { fetch }).send(undefined, {
      content: 'hello'
    });
    expect(result.success).toBe(status === 200);
    expect(result.receipt?.response?.status).toBe(status);
    if (!result.success) expect(result.error.code).toBe('SEND_FAILED');
  });

  it('records response JSON without requiring a success schema', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ success: false, arbitrary: 1 })
    );
    const result = await new GrokBotAdapter(connection, { fetch }).send(undefined, {
      content: 'hello'
    });
    expect(result.success).toBe(true);
    expect(result.receipt?.response?.body).toEqual({ success: false, arbitrary: 1 });
  });

  it('dry-run and pre-abort do not call fetch', async () => {
    const fetch = okFetch();
    const adapter = new GrokBotAdapter(connection, { fetch });
    expect(await adapter.send(undefined, { content: 'hello' }, { dryRun: true })).toEqual({
      success: true,
      dryRun: true,
      receipt: { request: expect.objectContaining({ body: { message: 'hello' } }) }
    });
    expect(
      await adapter.send(undefined, { content: 'hello' }, { signal: AbortSignal.abort() })
    ).toEqual({ success: false, error: { code: 'SEND_FAILED', message: expect.any(String) } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'abort', 'network'])('retains request receipts on %s', async (mode) => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (mode === 'network') throw new Error('private transport details');
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
        if (mode === 'abort') controller.abort();
      });
    });
    const adapter = new GrokBotAdapter({ ...connection, timeout_ms: 10 }, { fetch });
    const result = await adapter.send(
      undefined,
      { content: 'hello' },
      { signal: controller.signal }
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED' },
      receipt: { request: { body: { message: 'hello' }, timeout_ms: 10 } }
    });
    expect(result.receipt?.response).toBeUndefined();
    if (!result.success) {
      expect(result.error.message).toMatch(
        mode === 'timeout' ? /timed out/ : mode === 'abort' ? /aborted/ : /request failed/
      );
    }
  });

  it('keeps concurrent keys, bodies and URLs isolated', async () => {
    const fetch = okFetch();
    const adapter = new GrokBotAdapter(connection, { fetch });
    await Promise.all(
      ['one', 'two'].map((name) =>
        adapter.send(
          { url: `https://example.com/${name}`, key: `${name}-key`, body: { task: '{{message}}' } },
          { content: name }
        )
      )
    );
    for (const name of ['one', 'two']) {
      expect(fetch).toHaveBeenCalledWith(
        `https://example.com/${name}`,
        expect.objectContaining({
          headers: expect.objectContaining({ authorization: `Bearer ${name}-key` }),
          body: JSON.stringify({ task: name })
        })
      );
    }
  });
});
