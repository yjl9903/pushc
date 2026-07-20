import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findConfigPath, loadConfig, normalizeConfigPath, parsePushConfig } from '../src/config.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pushc-test-'));
  directories.push(path);
  return path;
}

describe('config', () => {
  it('uses explicit config and environment before discovered configs', async () => {
    const root = await tempDirectory();
    const explicit = join(root, 'explicit.toml');
    const fromEnv = join(root, 'env.toml');
    const fromCwd = join(root, '.pushc', 'config.toml');
    await mkdir(join(root, '.pushc'));
    await writeFile(explicit, '[adapters]\n');
    await writeFile(fromEnv, '[adapters]\n');
    await writeFile(fromCwd, '[adapters]\n');

    await expect(
      findConfigPath({ config: explicit, cwd: root, env: { PUSHC_CONFIG: fromEnv }, homeDir: root })
    ).resolves.toBe(explicit);
    await expect(
      findConfigPath({ cwd: root, env: { PUSHC_CONFIG: fromEnv }, homeDir: root })
    ).resolves.toBe(fromEnv);
  });

  it('normalizes config file and directory options against cwd', async () => {
    const root = await tempDirectory();
    const directory = join(root, 'config');
    const configPath = join(directory, 'config.toml');
    await mkdir(directory);
    await writeFile(configPath, '[adapters]\n');

    await expect(findConfigPath({ config: 'config', cwd: root, env: {} })).resolves.toBe(
      configPath
    );
    await expect(normalizeConfigPath('config/config.toml', root)).resolves.toBe(configPath);
  });

  it('discovers the cwd config before XDG and home configs', async () => {
    const root = await tempDirectory();
    const cwd = join(root, 'project');
    const home = join(root, 'home');
    const xdg = join(root, 'xdg');
    const cwdConfig = join(cwd, '.pushc', 'config.toml');
    const xdgConfig = join(xdg, 'pushc', 'config.toml');
    const homeConfig = join(home, '.config', 'pushc', 'config.toml');
    await Promise.all([
      mkdir(join(cwd, '.pushc'), { recursive: true }),
      mkdir(join(xdg, 'pushc'), { recursive: true }),
      mkdir(join(home, '.config', 'pushc'), { recursive: true })
    ]);
    await Promise.all([
      writeFile(cwdConfig, '[adapters]\n'),
      writeFile(xdgConfig, '[adapters]\n'),
      writeFile(homeConfig, '[adapters]\n')
    ]);

    await expect(
      findConfigPath({ cwd, env: { XDG_CONFIG_HOME: xdg }, homeDir: home })
    ).resolves.toBe(cwdConfig);
  });

  it('falls back from XDG config to the default home config', async () => {
    const root = await tempDirectory();
    const configPath = join(root, '.config', 'pushc', 'config.toml');
    await mkdir(join(root, '.config', 'pushc'), { recursive: true });
    await writeFile(configPath, '[adapters]\n');

    await expect(
      findConfigPath({ env: { XDG_CONFIG_HOME: join(root, 'missing') }, homeDir: root })
    ).resolves.toBe(configPath);
  });

  it('loads dotenv next to the config and expands environment variables', async () => {
    const root = await tempDirectory();
    const configPath = join(root, 'config.toml');
    await writeFile(join(root, '.env'), 'WEBHOOK_URL=https://example.com/from-dotenv\n');
    await writeFile(
      configPath,
      '[adapters.ops]\ntype = "webhook"\nurl = "${WEBHOOK_URL}"\nbody_mode = "json"\n[adapters.ops.targets.deploy]\nbody = { text = "{{message}}" }\n'
    );
    const env: NodeJS.ProcessEnv = {};

    const loaded = await loadConfig({ path: configPath, env });
    expect(loaded.config).toEqual({
      adapters: {
        ops: {
          type: 'webhook',
          url: 'https://example.com/from-dotenv',
          body_mode: 'json',
          targets: { deploy: { body: { text: '{{message}}' } } }
        }
      }
    });
    expect(parsePushConfig(loaded.config)).toEqual({
      adapters: {
        ops: {
          type: 'webhook',
          options: { url: 'https://example.com/from-dotenv', body_mode: 'json' },
          targets: { deploy: { body: { text: '{{message}}' } } }
        }
      }
    });
  });

  it('does not overwrite existing environment variables and reports missing ones safely', async () => {
    const root = await tempDirectory();
    const configPath = join(root, 'config.toml');
    await writeFile(join(root, '.env'), 'TOKEN=from-file\n');
    await writeFile(configPath, '[adapters.ops]\ntype = "webhook"\nurl = "${TOKEN}"\n');

    const loaded = await loadConfig({ path: configPath, env: { TOKEN: 'from-process' } });
    expect(loaded.config).toMatchObject({ adapters: { ops: { url: 'from-process' } } });

    await writeFile(configPath, '[adapters.ops]\ntype = "webhook"\nurl = "${MISSING_SECRET}"\n');
    await expect(loadConfig({ path: configPath, env: {} })).rejects.toMatchObject({
      code: 'ENV_MISSING',
      message: 'Environment variable MISSING_SECRET is required by the config.'
    });
  });

  it('rejects unknown root fields, invalid names and non-table targets', () => {
    expect(() => parsePushConfig({ version: 1, adapters: {} })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    );
    expect(() =>
      parsePushConfig({ adapters: { 'bad.name': { type: 'webhook', url: 'https://example.com' } } })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() =>
      parsePushConfig({
        adapters: {
          webhook: { type: 'webhook', url: 'https://example.com', targets: { 'bad:name': {} } }
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });
});
