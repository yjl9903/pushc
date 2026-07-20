import { describe, expect, it, vi } from 'vitest';
import { WebhookAdapter, parseWebhookConfig, parseWebhookTarget } from '../src/index.js';

describe('webhook adapter', () => {
  it('keeps connection config on the instance and sends a templated JSON target', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 204, statusText: 'No Content' })
    );
    const adapter = new WebhookAdapter(
      {
        url: 'https://example.com/hook',
        headers: { Authorization: 'Bearer token' }
      },
      { fetch }
    );
    await expect(
      adapter.send({
        target: { body: { content: '{{message}}', nested: ['prefix: {{message}}'] } },
        message: { content: 'ready' }
      })
    ).resolves.toEqual({
      status: 204,
      statusText: 'No Content'
    });

    expect(adapter.config.url).toBe('https://example.com/hook');
    const [, init] = fetch.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"content":"ready","nested":["prefix: ready"]}');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('supports text target bodies and custom connection content types', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('ok'));
    const adapter = new WebhookAdapter(
      {
        url: 'https://example.com/hook',
        headers: { 'Content-Type': 'text/markdown' }
      },
      { fetch }
    );
    await adapter.send({
      target: { body_mode: 'text', body: 'Message: {{message}}' },
      message: { content: 'hello' }
    });
    const [, init] = fetch.mock.calls[0]!;
    expect(init?.body).toBe('Message: hello');
    expect(new Headers(init?.headers).get('content-type')).toBe('text/markdown');
  });

  it('creates configured instances directly through its constructor', () => {
    const adapter = new WebhookAdapter({ url: 'https://example.com/hook' }, { fetch: vi.fn() });

    expect(adapter.config).toMatchObject({ url: 'https://example.com/hook' });
  });

  it('inherits target fields shallowly and rejects connection fields in partials', () => {
    const adapter = new WebhookAdapter({
      url: 'https://example.com/hook',
      body_mode: 'json',
      body: { inherited: true, content: 'base' }
    });

    adapter.targets.register('ops', { body: { content: '{{message}}' } });
    expect(adapter.targets.get('ops')).toEqual({
      body_mode: 'json',
      body: { content: '{{message}}' }
    });
    expect(() =>
      adapter.targets.register('invalid', { url: 'https://invalid.example' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('rejects invalid connection config, target config, and non-success status codes', async () => {
    expect(() => parseWebhookConfig({ url: 'file:///tmp/hook' })).toThrow(/HTTP or HTTPS/);
    expect(() => parseWebhookConfig({ url: 'https://example.com', timeoutMs: 5 })).toThrow(
      /Unknown webhook configuration field/
    );
    expect(() => parseWebhookConfig({ url: 'https://example.com', timeot_ms: 5 })).toThrow(
      /Unknown webhook configuration field/
    );
    expect(() => parseWebhookTarget({ body_mode: 'text', body: {} })).toThrow(/must be a string/);
    expect(() => parseWebhookTarget({ bodyMode: 'text' })).toThrow(/cannot override/);

    const adapter = new WebhookAdapter(
      { url: 'https://example.com/hook' },
      {
        fetch: vi.fn<typeof globalThis.fetch>(
          async () => new Response(null, { status: 503, statusText: 'Unavailable' })
        )
      }
    );
    await expect(adapter.send({ message: { content: 'hello' } })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503
    });
  });

  it('aborts requests after the configured timeout', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true
          });
        })
    );
    const adapter = new WebhookAdapter(
      { url: 'https://example.com/hook', timeout_ms: 5 },
      { fetch }
    );

    await expect(adapter.send({ message: { content: 'hello' } })).rejects.toMatchObject({
      code: 'ABORTED'
    });
  });
});
