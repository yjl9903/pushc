import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrokBotAdapter } from '@pushc/adapter-grok-bot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePushRuntime } from '../src/client.js';
import { getSendResultExitCode } from '../src/error.js';
import { formatSendResult } from '../src/utils/format.js';

const directories: string[] = [];
const env = {
  GROK_TEST_URL: 'https://example.com/private-routine',
  GROK_TEST_KEY: 'placeholder-grok-token',
  GROK_TEST_TARGET_URL: 'https://example.com/private-research',
  GROK_TEST_TARGET_KEY: 'placeholder-research-token'
};
async function configFile(extra = ''): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pushc-grok-test-'));
  directories.push(root);
  const path = join(root, 'config.toml');
  await writeFile(
    path,
    [
      '[adapters.grok]',
      'type = "grok-bot"',
      'url = "${GROK_TEST_URL}"',
      'key = "${GROK_TEST_KEY}"',
      extra
    ].join('\n')
  );
  return path;
}
const namedTarget = [
  '[adapters.grok.targets.research]',
  'url = "${GROK_TEST_TARGET_URL}"',
  'key = "${GROK_TEST_TARGET_KEY}"',
  '[adapters.grok.targets.research.body]',
  'task = "{{message}}"'
].join('\n');

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('Grok Bot CLI integration', () => {
  it('constructs and sends default and named targets with interpolated credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const runtime = await makePushRuntime({
      config: await configFile(namedTarget),
      env: { ...env }
    });
    expect(runtime.success).toBe(true);
    if (!runtime.success) throw runtime.error;
    try {
      expect(runtime.client.adapters.get('grok')).toBeInstanceOf(GrokBotAdapter);
      for (const destination of ['grok', 'grok:research']) {
        const result = await runtime.client.send(destination, { content: 'hello' });
        expect(result.success).toBe(true);
        expect(getSendResultExitCode(result)).toBe(0);
        for (const json of [true, false]) {
          const output = formatSendResult(result, json, runtime.redactions);
          for (const value of Object.values(env)) expect(output).not.toContain(value);
          expect(output).toContain('Grok Bot routine triggered (HTTP 200).');
        }
      }
      expect(fetch.mock.calls[0]?.[1]?.body).toBe('{"message":"hello"}');
      expect(fetch.mock.calls[1]?.[1]?.body).toBe('{"task":"hello"}');
      expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
        authorization: `Bearer ${env.GROK_TEST_TARGET_KEY}`
      });
    } finally {
      await runtime.client.destroy();
    }
  });

  it('keeps response failures and receipts redacted with exit status 1', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () =>
        Response.json({ echoed: env.GROK_TEST_KEY }, { status: 202 })
      )
    );
    const runtime = await makePushRuntime({ config: await configFile(), env: { ...env } });
    if (!runtime.success) throw runtime.error;
    try {
      const result = await runtime.client.send('grok', { content: 'hello' });
      expect(result).toMatchObject({
        success: false,
        error: { code: 'SEND_FAILED' },
        receipt: { response: { status: 202 } }
      });
      expect(getSendResultExitCode(result)).toBe(1);
      const output = formatSendResult(result, true, runtime.redactions);
      expect(output).toContain('[REDACTED]');
      for (const value of Object.values(env)) expect(output).not.toContain(value);
    } finally {
      await runtime.client.destroy();
    }
  });

  it('built CLI lists targets and prepares redacted custom bodies without transport', async () => {
    const config = await configFile(namedTarget);
    const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
    const run = (args: string[]) =>
      spawnSync(process.execPath, [cli, ...args, '--config', config, '--json'], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 5000
      });
    const targets = run(['targets']);
    expect(targets.status).toBe(0);
    expect(targets.stderr).toBe('');
    expect(JSON.parse(targets.stdout)).toEqual({
      success: true,
      targets: [{ adapter: 'grok', target: 'research' }]
    });
    const dryRun = run(['send', 'hello', '--target', 'grok:research', '--dry-run']);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stderr).toBe('');
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      success: true,
      dryRun: true,
      receipt: {
        request: {
          url: '[REDACTED]',
          headers: { authorization: 'Bearer [REDACTED]' },
          body: { task: 'hello' }
        }
      }
    });
    for (const value of Object.values(env))
      expect(targets.stdout + dryRun.stdout).not.toContain(value);
  });

  it.each([
    '[adapters.grok.targets.bad]\nkey = "${GROK_TEST_TARGET_KEY}"',
    '[adapters.grok.targets.bad]\nurl = "https://other.example.com/private"\nkey = "${GROK_TEST_TARGET_KEY}"',
    'body = 1979-05-27T07:32:00Z',
    'body = { nested = 1979-05-27T07:32:00Z }'
  ])(
    'built CLI rejects invalid configuration before send and uses exit status 2: %#',
    async (extra) => {
      const config = await configFile(extra);
      const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
      const result = spawnSync(process.execPath, [cli, 'targets', '--config', config, '--json'], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 5000
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr)).toMatchObject({
        success: false,
        error: { code: 'INVALID_CONFIG' }
      });
      for (const value of Object.values(env)) expect(result.stderr).not.toContain(value);
      expect(result.stderr).not.toContain('other.example.com');
    }
  );
});
