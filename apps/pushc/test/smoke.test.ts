import { spawnSync } from 'node:child_process';
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
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: { code: 'CONFIG_NOT_FOUND' }
    });
  });

  it('requires the target option inside the send action', () => {
    const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'send', 'message', '--json'], {
      encoding: 'utf8'
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TARGET' }
    });
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
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        targets: [{ adapter: 'qq', target: 'ops' }, { adapter: 'webhook' }]
      });
      expect(result.stdout).not.toContain('example.com');
      expect(result.stderr).toBe('');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
