import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NapCatAdapter } from '@pushc/adapter-napcat';
import { WebhookAdapter } from '@pushc/adapter-webhook';
import { afterEach, describe, expect, it } from 'vitest';
import { makePushClient } from '../src/client.js';

const directories: string[] = [];
const envName = 'PUSHC_TEST_WEBHOOK_URL_019F7833';
const originalEnvValue = process.env[envName];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
  if (originalEnvValue === undefined) {
    delete process.env[envName];
  } else {
    process.env[envName] = originalEnvValue;
  }
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pushc-client-test-'));
  directories.push(path);
  return path;
}

describe('makePushClient', () => {
  it('constructs adapters with generated default or adapter-owned named targets', async () => {
    const root = await tempDirectory();
    delete process.env[envName];
    await writeFile(join(root, '.env'), `${envName}=https://example.com/from-env\n`);
    await writeFile(
      join(root, 'config.toml'),
      [
        '[adapters.webhook]',
        'type = "webhook"',
        `url = "\${${envName}}"`,
        '[adapters.qq]',
        'type = "napcat"',
        'base_url = "ws://127.0.0.1:3001"',
        '[adapters.qq.targets.ops]',
        'group_id = "123456"',
        '[adapters.qq.targets.alerts]',
        'group_id = "654321"'
      ].join('\n')
    );

    const client = await makePushClient(join(root, 'config.toml'));
    const webhook = client.adapters.get('webhook');
    const qq = client.adapters.get('qq');

    expect(webhook).toBeInstanceOf(WebhookAdapter);
    expect(webhook?.config).toMatchObject({ url: 'https://example.com/from-env' });
    expect([...webhook!.targets]).toEqual([]);
    expect(webhook!.targets.resolve()).toEqual({
      body_mode: 'json',
      body: { text: '{{message}}' }
    });
    expect(qq).toBeInstanceOf(NapCatAdapter);
    expect([...qq!.targets]).toEqual([
      ['ops', { group_id: '123456' }],
      ['alerts', { group_id: '654321' }]
    ]);
  });

  it('accepts an explicit config file path', async () => {
    const root = await tempDirectory();
    await mkdir(join(root, 'nested'));
    await writeFile(
      join(root, 'nested', 'custom.toml'),
      '[adapters.webhook]\ntype = "webhook"\nurl = "https://example.com"\n'
    );

    const client = await makePushClient(join(root, 'nested', 'custom.toml'));

    expect(client.adapters.get('webhook')?.targets.size).toBe(0);
    expect(client.adapters.get('webhook')?.targets.resolve()).toEqual({
      body_mode: 'json',
      body: { text: '{{message}}' }
    });
  });

  it('rejects protected target fields without registering a partial adapter', async () => {
    const root = await tempDirectory();
    const config = join(root, 'config.toml');
    await writeFile(
      config,
      '[adapters.webhook]\ntype = "webhook"\nurl = "https://example.com"\n[adapters.webhook.targets.ops]\nurl = "https://invalid.example"\n'
    );

    await expect(makePushClient(config)).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      message: expect.stringContaining('adapter "webhook"')
    });
  });

  it('reports unsupported implementations, constructor failures and invalid defaults', async () => {
    const root = await tempDirectory();
    const config = join(root, 'config.toml');
    await writeFile(config, '[adapters.custom]\ntype = "custom"\n');
    await expect(makePushClient(config)).rejects.toMatchObject({ code: 'UNKNOWN_ADAPTER' });

    await writeFile(config, '[adapters.webhook]\ntype = "webhook"\n');
    await expect(makePushClient(config)).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      cause: expect.any(Error)
    });

    await writeFile(config, '[adapters.qq]\ntype = "napcat"\nbase_url = "ws://localhost"\n');
    await expect(makePushClient(config)).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      message: expect.stringContaining('adapter "qq"')
    });
  });
});
