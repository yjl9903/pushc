import { describe, expect, it, vi } from 'vitest';
import {
  WebhookAdapter,
  WebhookError,
  parseContentType,
  parseWebhookConfig,
  renderWebhookTemplate
} from '../src/index.js';
import { buildWebhookRequest } from '../src/request.js';

function okFetch() {
  return vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 204, statusText: 'No Content' })
  );
}

describe('webhook configuration and targets', () => {
  it('uses request defaults without inventing a body or Content-Type', async () => {
    const fetch = okFetch();
    const adapter = new WebhookAdapter({ url: 'https://example.com/hook' }, { fetch });

    expect(adapter.config).toMatchInlineSnapshot(`
      {
        "request": {
          "headers": {},
          "method": "POST",
          "timeout_ms": 10000,
          "url": "https://example.com/hook",
        },
        "response": {},
        "url": "https://example.com/hook",
      }
    `);
    expect(adapter.targets.resolve()).toMatchInlineSnapshot(`
      {
        "request": {
          "headers": {},
          "method": "POST",
          "timeout_ms": 10000,
          "url": "https://example.com/hook",
        },
        "response": {},
      }
    `);
    await expect(adapter.send(undefined, { message: 'hello' })).resolves.toMatchInlineSnapshot(`
      {
        "receipt": {
          "request": {
            "headers": {},
            "method": "POST",
            "timeout_ms": 10000,
            "url": "https://example.com/hook",
          },
          "response": {
            "headers": {},
            "status": 204,
          },
          "summary": "Webhook POST to example.com completed with HTTP 204.",
        },
        "success": true,
      }
    `);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://example.com/hook');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
  });

  it('defaults content_type when a target first provides a body', () => {
    const adapter = new WebhookAdapter({ url: 'https://example.com' });
    expect(adapter.parseTarget({ request: { body: { message: '{{message}}' } } }))
      .toMatchInlineSnapshot(`
      {
        "request": {
          "body": {
            "message": "{{message}}",
          },
          "content_type": "application/json",
          "headers": {},
          "method": "POST",
          "timeout_ms": 10000,
          "url": "https://example.com/",
        },
        "response": {},
      }
    `);
  });

  it('merges headers case-insensitively and object bodies shallowly', () => {
    const adapter = new WebhookAdapter({
      url: 'https://example.com',
      request: {
        headers: { Authorization: 'base', 'X-Base': 'yes' },
        body: { inherited: true, nested: { base: true }, replace: 'base' }
      }
    });
    adapter.targets.register('ops', {
      request: {
        headers: { authorization: 'target', 'X-Target': 'yes' },
        body: { nested: { target: true }, replace: 'target' }
      }
    });

    expect(adapter.targets.get('ops')).toMatchInlineSnapshot(`
      {
        "request": {
          "body": {
            "inherited": true,
            "nested": {
              "target": true,
            },
            "replace": "target",
          },
          "content_type": "application/json",
          "headers": {
            "authorization": "target",
            "x-base": "yes",
            "x-target": "yes",
          },
          "method": "POST",
          "timeout_ms": 10000,
          "url": "https://example.com/",
        },
        "response": {},
      }
    `);
    expect(
      captureError(
        () =>
          new WebhookAdapter({
            url: 'https://example.com',
            request: { headers: { Authorization: 'one', authorization: 'two' } }
          })
      )
    ).toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Invalid webhook configuration.",
        "name": "WebhookError",
      }
    `);
  });

  it('replaces non-object bodies and treats null as an explicit body', () => {
    const adapter = new WebhookAdapter({
      url: 'https://example.com',
      request: { body: { inherited: true } }
    });
    expect(adapter.parseTarget({ request: { body: ['replacement'] } }).request.body)
      .toMatchInlineSnapshot(`
      [
        "replacement",
      ]
    `);
    expect(adapter.parseTarget({ request: { body: null } }).request.body).toBeNull();
    expect(adapter.parseTarget({ request: { headers: {} } }).request.headers).toMatchInlineSnapshot(
      `{}`
    );
    expect(adapter.parseTarget({}).request.body).toMatchInlineSnapshot(`
      {
        "inherited": true,
      }
    `);
  });

  it('keeps response as a strict empty placeholder', () => {
    const adapter = new WebhookAdapter({
      url: 'https://example.com',
      response: {}
    });
    expect(adapter.parseTarget({ response: {} }).response).toMatchInlineSnapshot(`{}`);
    expect(captureError(() => adapter.parseTarget({ response: { parser: 'json' } })))
      .toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Invalid webhook configuration.",
        "name": "PushError",
      }
    `);
    expect(captureError(() => adapter.parseTarget({ method: 'PUT' }))).toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Invalid webhook configuration.",
        "name": "PushError",
      }
    `);
    expect(captureError(() => adapter.parseTarget(JSON.parse('{"__proto__":true}'))))
      .toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Invalid webhook configuration.",
        "name": "PushError",
      }
    `);
  });

  it('normalizes method, media type, timeout and safe bigint JSON values', () => {
    expect(
      parseWebhookConfig({
        url: 'https://EXAMPLE.com:443/hook',
        request: {
          method: ' patch ',
          content_type: ' Application/JSON ; charset = UTF-8 ',
          timeout_ms: 2_147_483_647n,
          body: { count: 42n }
        },
        response: {}
      })
    ).toMatchInlineSnapshot(`
      {
        "request": {
          "body": {
            "count": 42,
          },
          "content_type": "application/json; charset=utf-8",
          "headers": {},
          "method": "PATCH",
          "timeout_ms": 2147483647,
          "url": "https://example.com/hook",
        },
        "response": {},
        "url": "https://example.com/hook",
      }
    `);
    expect(parseContentType(' text/plain ; charset=utf-8 ')).toMatchInlineSnapshot(`
      {
        "essence": "text/plain",
        "value": "text/plain; charset=utf-8",
      }
    `);
  });

  it.each([
    {},
    { url: 'file:///tmp/hook' },
    { url: 'https://user:secret@example.com' },
    { url: 'https://example.com/{{message}}' },
    { url: 'https://example.com', body_mode: 'json' },
    { url: 'https://example.com', method: '' },
    { url: 'https://example.com', response: { parser: 'json' } },
    { url: 'https://example.com', request: { method: 'TRACE' } },
    { url: 'https://example.com', request: { timeout_ms: 0 } },
    { url: 'https://example.com', request: { timeout_ms: 2_147_483_648 } },
    { url: 'https://example.com', request: { content_type: 'text/markdown' } },
    { url: 'https://example.com', request: { body: Number.NaN } },
    { url: 'https://example.com', request: { body: 9_007_199_254_740_992n } },
    { url: 'https://example.com', request: { body: { bad: undefined } } },
    { url: 'https://example.com', request: { method: 'GET', body: null } },
    { url: 'https://example.com', request: { content_type: 'text/plain', body: {} } },
    JSON.parse('{"url":"https://example.com","__proto__":true}'),
    { url: 'https://example.com', request: JSON.parse('{"__proto__":true}') }
  ])('rejects invalid config %#', (config) => {
    expect(captureError(() => parseWebhookConfig(config))).toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Invalid webhook configuration.",
        "name": "WebhookError",
      }
    `);
  });

  it('rejects circular JSON while preserving a sanitized cause chain', () => {
    const body: Record<string, unknown> = {};
    body.self = body;
    try {
      parseWebhookConfig({ url: 'https://example.com', request: { body } });
      throw new Error('expected failure');
    } catch (error) {
      expect({
        error: errorSummary(error),
        hasCause: error instanceof Error && 'cause' in error
      }).toMatchInlineSnapshot(`
        {
          "error": {
            "code": "INVALID_CONFIG",
            "message": "Invalid webhook configuration.",
            "name": "WebhookError",
          },
          "hasCause": true,
        }
      `);
    }
  });
});

describe('webhook templates and requests', () => {
  it('carries the resolved timeout in the built request', () => {
    const adapter = new WebhookAdapter({
      url: 'https://example.com',
      request: { timeout_ms: 1234 }
    });

    expect(
      buildWebhookRequest(adapter.config.request, 'https://example.com', {
        message: 'hello'
      }).timeout_ms
    ).toBe(1234);
  });

  it('records the same normalized headers that fetch receives', async () => {
    const fetch = okFetch();
    const adapter = new WebhookAdapter(
      {
        url: 'https://example.com',
        request: { headers: { 'X-Token': '  token\t ' } }
      },
      { fetch }
    );

    const result = await adapter.send(undefined, { message: 'hello' });
    expect(result).toMatchObject({
      success: true,
      receipt: { request: { headers: { 'x-token': 'token' } } }
    });
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('x-token')).toBe('token');
  });

  it('renders payload fields into request URL, headers and JSON string values', async () => {
    const fetch = okFetch();
    const adapter = new WebhookAdapter(
      {
        url: 'https://example.com/base',
        request: {
          url: 'https://example.com/push/{{param.topic}}?title={{title}}',
          headers: { 'X-Base': 'base' },
          body: { inherited: true }
        }
      },
      { fetch }
    );

    await adapter.send(
      {
        request: {
          headers: {
            'X-Title': '{{title:-pushc}}',
            'X-Level': '{{param.level:-active}}'
          },
          body: {
            message: '{{message}}',
            title: '{{title:-pushc}}',
            group: '{{param.group:-default}}',
            fixed: 1
          }
        }
      },
      {
        message: 'build complete',
        title: '',
        param: { topic: 'deployments', group: 'production' }
      }
    );

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://example.com/push/deployments?title=');
    expect(new Headers(init?.headers).get('x-title')).toBe('pushc');
    expect(new Headers(init?.headers).get('x-level')).toBe('active');
    expect(JSON.parse(String(init?.body))).toMatchInlineSnapshot(`
      {
        "fixed": 1,
        "group": "production",
        "inherited": true,
        "message": "build complete",
        "title": "pushc",
      }
    `);
  });

  it('prepares the final request in dry-run without calling fetch', async () => {
    const fetch = okFetch();
    const adapter = new WebhookAdapter(
      {
        url: 'https://example.com/base',
        request: {
          url: 'https://example.com/push/{{param.topic}}',
          headers: { 'X-Title': '{{title:-pushc}}' },
          body: {
            message: '{{message}}',
            group: '{{param.group:-default}}'
          }
        }
      },
      { fetch }
    );

    await expect(
      adapter.send(
        undefined,
        {
          message: 'build complete',
          title: '',
          param: { topic: 'deployments', group: 'production' }
        },
        { dryRun: true }
      )
    ).resolves.toEqual({
      dryRun: true,
      success: true,
      receipt: {
        request: {
          url: 'https://example.com/push/deployments',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-title': 'pushc'
          },
          content_type: 'application/json',
          timeout_ms: 10_000,
          body: {
            message: 'build complete',
            group: 'production'
          }
        }
      }
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects attachments without calling fetch in send or dry-run', async () => {
    const fetch = okFetch();
    const adapter = new WebhookAdapter({ url: 'https://example.com/hook' }, { fetch });
    const payload = { message: '', attachments: ['photo.png'] };

    await expect(adapter.send(undefined, payload)).resolves.toMatchObject({
      success: false,
      error: {
        code: 'INVALID_MESSAGE',
        message: 'Webhook does not support attachments.'
      }
    });
    await expect(adapter.send(undefined, payload, { dryRun: true })).resolves.toMatchObject({
      dryRun: true,
      success: false,
      error: {
        code: 'INVALID_MESSAGE',
        message: 'Webhook does not support attachments.'
      }
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scans once, supports fallback, and preserves invalid expressions', () => {
    const payload = {
      message: '{{title}}',
      title: '',
      param: { empty: '', spaced: ' ', inject: '{{message}}' }
    };
    expect(
      renderWebhookTemplate(
        String.raw`{{ message }}|{{title:-alpha:-beta}}|{{param.empty:-x}}|{{param.spaced:-x}}|{{param.inject}}|\{{title}}|{{unknown}}|{{`,
        payload
      )
    ).toBe('{{title}}|alpha:-beta|x| |{{message}}|{{title}}|{{unknown}}|{{');
  });

  it('sends text bodies without JSON quoting', async () => {
    const fetch = okFetch();
    const adapter = new WebhookAdapter(
      {
        url: 'https://example.com/topic',
        request: {
          content_type: 'text/plain; charset=utf-8',
          body: 'Message: {{message}}'
        }
      },
      { fetch }
    );
    await adapter.send(undefined, { message: 'hello' });
    const [, init] = fetch.mock.calls[0]!;
    expect(init?.body).toBe('Message: hello');
    expect(new Headers(init?.headers).get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('keeps an explicit compatible Content-Type and rejects conflicts', async () => {
    const fetch = okFetch();
    const compatible = new WebhookAdapter(
      {
        url: 'https://example.com',
        request: {
          content_type: 'application/json',
          headers: { 'Content-Type': ' Application/JSON ; charset = utf-8 ' },
          body: { message: '{{message}}' }
        }
      },
      { fetch }
    );
    await compatible.send(undefined, { message: 'ok' });
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('content-type')).toBe(
      'Application/JSON ; charset = utf-8'
    );

    const conflicting = new WebhookAdapter(
      {
        url: 'https://example.com',
        request: {
          content_type: 'application/json',
          headers: { 'Content-Type': '{{param.type}}' },
          body: {}
        }
      },
      { fetch }
    );
    await expect(
      conflicting.send(undefined, {
        message: 'ok',
        param: { type: 'text/plain' }
      })
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_CONFIG' }
    });
  });

  it('does not parse or add Content-Type when body is absent', async () => {
    const fetch = okFetch();
    const adapter = new WebhookAdapter(
      {
        url: 'https://example.com',
        request: {
          content_type: 'application/json',
          headers: { 'Content-Type': 'text/markdown' }
        }
      },
      { fetch }
    );
    await adapter.send(undefined, { message: 'ok' });
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('content-type')).toBe('text/markdown');
  });

  it.each([
    'https://other.example/hook',
    'http://example.com/hook',
    '/relative',
    'https://user:secret@example.com/hook'
  ])('rejects unsafe target URL %s at send time', async (url) => {
    const adapter = new WebhookAdapter({ url: 'https://example.com/base' }, { fetch: okFetch() });
    await expect(adapter.send({ request: { url } }, { message: 'ok' })).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_CONFIG' }
    });
  });

  it('accepts same-origin default-port normalization', async () => {
    const fetch = okFetch();
    const adapter = new WebhookAdapter({ url: 'https://example.com/base' }, { fetch });
    await adapter.send(
      { request: { url: 'https://example.com:443/other path' } },
      { message: 'ok' }
    );
    expect(fetch.mock.calls[0]![0]).toBe('https://example.com/other%20path');
  });

  it('isolates request state across concurrent sends', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      calls.push([url, init]);
      await Promise.resolve();
      return new Response(null, { status: 204 });
    });
    const adapter = new WebhookAdapter(
      {
        url: 'https://example.com',
        request: {
          headers: { 'X-Message': '{{message}}' },
          body: { message: '{{message}}' }
        }
      },
      { fetch }
    );

    await Promise.all([
      adapter.send(undefined, { message: 'first' }),
      adapter.send(undefined, { message: 'second' })
    ]);
    expect(calls.map(([, init]) => new Headers(init?.headers).get('x-message')))
      .toMatchInlineSnapshot(`
      [
        "first",
        "second",
      ]
    `);
    expect(calls.map(([, init]) => init?.body)).toMatchInlineSnapshot(`
      [
        "{"message":"first"}",
        "{"message":"second"}",
      ]
    `);
  });
});

function captureError(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return errorSummary(error);
  }
  throw new Error('Expected callback to throw.');
}

function errorSummary(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    ...('code' in error ? { code: error.code } : {}),
    message: error.message
  };
}

describe('webhook errors and lifecycle', () => {
  it.each([0, false, '', null])('preserves falsy WebhookError causes %#', (cause) => {
    const error = new WebhookError('INVALID_CONFIG', 'invalid', { cause });
    expect(error.cause).toBe(cause);
  });

  it('keeps HTTP receipt behavior and HTTP errors', async () => {
    const adapter = new WebhookAdapter(
      { url: 'https://example.com' },
      {
        fetch: vi.fn<typeof globalThis.fetch>(
          async () => new Response(null, { status: 503, statusText: 'Unavailable' })
        )
      }
    );
    await expect(adapter.send(undefined, { message: 'ok' })).resolves.toMatchObject({
      success: false,
      receipt: { response: { status: 503 } },
      error: { code: 'SEND_FAILED', message: 'Webhook returned HTTP 503.' }
    });
  });

  it('reports unavailable fetch directly', async () => {
    const adapter = new WebhookAdapter({ url: 'https://example.com' }, { fetch: 0 as never });
    await expect(adapter.send(undefined, { message: 'ok' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'This runtime does not provide fetch.' }
    });
  });

  it('aborts requests after timeout and caller cancellation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true
          });
        })
    );
    const adapter = new WebhookAdapter(
      { url: 'https://example.com', request: { timeout_ms: 5 } },
      { fetch }
    );
    await expect(adapter.send(undefined, { message: 'hello' })).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: expect.stringContaining('timed out') }
    });

    const controller = new AbortController();
    const pending = adapter.send(
      undefined,
      { message: 'hello' },
      {
        signal: controller.signal
      }
    );
    controller.abort(new Error('cancelled'));
    await expect(pending).resolves.toMatchObject({
      success: false,
      error: { code: 'SEND_FAILED', message: 'Message sending was aborted.' }
    });
  });

  it('keeps structured request bodies and parses safe response data', async () => {
    const adapter = new WebhookAdapter(
      {
        url: 'https://example.com:8443/hook',
        request: {
          headers: { authorization: 'Bearer secret', 'x-trace': 'request-trace' },
          body: { text: '{{message}}' }
        }
      },
      {
        fetch: vi.fn(
          async () =>
            new Response('{"accepted":true}', {
              status: 202,
              headers: {
                'content-type': 'application/json',
                'x-trace': 'response-trace',
                'www-authenticate': 'secret'
              }
            })
        )
      }
    );

    await expect(adapter.send(undefined, { message: 'hello' })).resolves.toEqual({
      success: true,
      receipt: {
        summary: 'Webhook POST to example.com:8443 completed with HTTP 202.',
        request: {
          url: 'https://example.com:8443/hook',
          method: 'POST',
          headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
            'x-trace': 'request-trace'
          },
          content_type: 'application/json',
          timeout_ms: 10_000,
          body: { text: 'hello' }
        },
        response: {
          status: 202,
          headers: {
            'content-type': 'application/json',
            'x-trace': 'response-trace'
          },
          body: { accepted: true }
        }
      }
    });
  });
});
