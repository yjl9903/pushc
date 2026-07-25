import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('built CLI', () => {
  it('is executable by Node and reports its version', () => {
    const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0.0.0');
    expect(result.stderr).toBe('');
  });

  it('writes errors and sets the process exit code directly', () => {
    const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
    const missingConfig = fileURLToPath(new URL('./missing-config.toml', import.meta.url));
    const result = spawnSync(
      process.execPath,
      [cli, 'send', 'message', '--target', 'missing', '--config', missingConfig, '--json'],
      { encoding: 'utf8' }
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchInlineSnapshot(
      {
        error: { message: expect.any(String) }
      },
      `
      {
        "error": {
          "code": "CONFIG_NOT_FOUND",
          "message": Any<String>,
        },
        "success": false,
      }
    `
    );
  });

  it('requires the target option inside the send action', () => {
    const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'send', 'message', '--json'], {
      encoding: 'utf8'
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchInlineSnapshot(`
      {
        "error": {
          "code": "INVALID_TARGET",
          "message": "The --target option is required.",
        },
        "success": false,
      }
    `);
  });

  it('returns a redacted final request without sending it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pushc-dry-run-'));
    const config = join(root, 'config.toml');
    await writeFile(
      config,
      [
        '[adapters.webhook]',
        'type = "webhook"',
        'url = "http://127.0.0.1:1/${PUSHC_TEST_DRY_RUN_TOKEN}"',
        '[adapters.webhook.request]',
        'content_type = "application/json"',
        '[adapters.webhook.request.headers]',
        'Authorization = "Bearer ${PUSHC_TEST_DRY_RUN_TOKEN}"',
        '[adapters.webhook.request.body]',
        'message = "{{message}}"',
        'title = "{{title:-pushc}}"',
        'group = "{{param.group:-default}}"'
      ].join('\n')
    );

    try {
      const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'send',
          'build complete',
          '--target',
          'webhook',
          '--title',
          '',
          '--param',
          'group=releases',
          '--dry-run',
          '--config',
          config,
          '--json'
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, PUSHC_TEST_DRY_RUN_TOKEN: 'private-token' }
        }
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        dryRun: true,
        success: true,
        adapter: 'webhook',
        receipt: {
          request: {
            url: '[REDACTED]',
            method: 'POST',
            headers: {
              authorization: '[REDACTED]',
              'content-type': 'application/json'
            },
            content_type: 'application/json',
            timeout_ms: 10_000,
            body: {
              message: 'build complete',
              title: 'pushc',
              group: 'releases'
            }
          }
        }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prepares repeatable local and remote attachments without sending to NapCat', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pushc-attachment-dry-run-'));
    const config = join(root, 'config.toml');
    const image = join(root, 'photo.png');
    const document = join(root, 'report.txt');
    await writeFile(
      config,
      [
        '[adapters.qq]',
        'type = "napcat"',
        'base_url = "ws://127.0.0.1:1"',
        '[adapters.qq.targets.ops]',
        'group_id = "123"'
      ].join('\n')
    );
    await writeFile(image, 'image');
    await writeFile(document, 'report');

    try {
      const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'send',
          '--target',
          'qq:ops',
          '--attachment',
          image,
          '--attachment',
          document,
          '--attachment',
          'https://cdn.example.com/clip.mp4?token=secret',
          '--dry-run',
          '--config',
          config,
          '--json'
        ],
        { encoding: 'utf8' }
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        dryRun: true,
        success: true,
        adapter: 'qq',
        target: 'ops',
        receipt: {
          request: {
            method: 'send_msg',
            params: {
              group_id: 123,
              message: [
                attachmentReceipt('image', 'photo.png', 'image/png', 'image'),
                attachmentReceipt('file', 'report.txt', 'text/plain', 'report'),
                remoteAttachmentReceipt('video', 'clip.mp4', 'video/mp4', 'cdn.example.com')
              ]
            }
          }
        }
      });
      expect(result.stdout).not.toContain(root);
      expect(result.stdout).not.toContain('base64://');
      expect(result.stdout).not.toContain('token=secret');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('registers the targets command at the executable entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pushc-smoke-'));
    const config = join(root, 'config.toml');
    await writeFile(
      config,
      '[adapters.webhook]\ntype = "webhook"\nurl = "https://example.com/hook"\n[adapters.qq]\ntype = "napcat"\nbase_url = "ws://localhost:3001"\n[adapters.qq.targets.ops]\ngroup_id = "123456"\n'
    );

    try {
      const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
      const result = spawnSync(process.execPath, [cli, 'targets', '--config', config, '--json'], {
        encoding: 'utf8'
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
        {
          "success": true,
          "targets": [
            {
              "adapter": "qq",
              "target": "ops",
            },
            {
              "adapter": "webhook",
            },
          ],
        }
      `);
      expect(result.stdout).not.toContain('example.com');
      expect(result.stderr).toBe('');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function attachmentReceipt(
  type: 'image' | 'file',
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

function remoteAttachmentReceipt(
  type: 'image' | 'video' | 'file',
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
