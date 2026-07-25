import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findConfigPath, loadConfig, normalizeConfigPath, parsePushConfig } from '../src/config.js';
import { redactForOutput } from '../src/utils/redact.js';

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
      findConfigPath({
        env: { XDG_CONFIG_HOME: join(root, 'missing') },
        homeDir: root,
        cwd: root
      })
    ).resolves.toBe(configPath);
  });

  it('loads dotenv next to the config and expands environment variables', async () => {
    const root = await tempDirectory();
    const configPath = join(root, 'config.toml');
    await writeFile(join(root, '.env'), 'WEBHOOK_URL=https://example.com/from-dotenv\n');
    await writeFile(
      configPath,
      '[adapters.ops]\ntype = "webhook"\nurl = "${WEBHOOK_URL}"\n[adapters.ops.request]\ncontent_type = "application/json"\n[adapters.ops.targets.deploy.request]\nbody = { text = "{{message}}" }\n'
    );
    const env: NodeJS.ProcessEnv = {};

    const loaded = await loadConfig({ path: configPath, env });
    expect(loaded.redactions).toEqual([
      'https%3A%2F%2Fexample.com%2Ffrom-dotenv',
      'https://example.com/from-dotenv'
    ]);
    expect(loaded.config).toMatchInlineSnapshot(`
      {
        "adapters": {
          "ops": {
            "request": {
              "content_type": "application/json",
            },
            "targets": {
              "deploy": {
                "request": {
                  "body": {
                    "text": "{{message}}",
                  },
                },
              },
            },
            "type": "webhook",
            "url": "https://example.com/from-dotenv",
          },
        },
      }
    `);
    expect(parsePushConfig(loaded.config)).toMatchInlineSnapshot(`
      {
        "adapters": {
          "ops": {
            "options": {
              "request": {
                "content_type": "application/json",
              },
              "url": "https://example.com/from-dotenv",
            },
            "targets": {
              "deploy": {
                "request": {
                  "body": {
                    "text": "{{message}}",
                  },
                },
              },
            },
            "type": "webhook",
          },
        },
      }
    `);
  });

  it('does not overwrite existing environment variables and reports missing ones safely', async () => {
    const root = await tempDirectory();
    const configPath = join(root, 'config.toml');
    await writeFile(join(root, '.env'), 'TOKEN=from-file\n');
    await writeFile(configPath, '[adapters.ops]\ntype = "webhook"\nurl = "${TOKEN}"\n');

    const loaded = await loadConfig({ path: configPath, env: { TOKEN: 'from-process' } });
    expect(loaded.redactions).toEqual(['from-process']);
    expect(loaded.config).toMatchInlineSnapshot(`
      {
        "adapters": {
          "ops": {
            "type": "webhook",
            "url": "from-process",
          },
        },
      }
    `);

    await writeFile(configPath, '[adapters.ops]\ntype = "webhook"\nurl = "${MISSING_SECRET}"\n');
    await expect(loadConfig({ path: configPath, env: {} })).rejects.toMatchObject({
      code: 'ENV_MISSING',
      message: 'Environment variable MISSING_SECRET is required by the config.'
    });
  });

  it('tracks encoded and URL-normalized forms of referenced environment values', async () => {
    const root = await tempDirectory();
    const configPath = join(root, 'config.toml');
    await writeFile(
      configPath,
      '[adapters.ops]\ntype = "webhook"\nurl = "https://example.com/${TOKEN}"\n[adapters.ops.request.headers]\nAuthorization = "${HEADER_TOKEN}"\n'
    );

    const loaded = await loadConfig({
      path: configPath,
      env: { TOKEN: 'token with space', HEADER_TOKEN: '  header-secret\t' }
    });

    expect(loaded.redactions).toEqual(
      expect.arrayContaining([
        'token with space',
        'token%20with%20space',
        'https://example.com/token%20with%20space',
        'header-secret'
      ])
    );
    expect(redactForOutput('https://example.com/token%20with%20space', loaded.redactions)).toBe(
      '[REDACTED]'
    );
  });

  it('redacts referenced environment values normalized to numbers', () => {
    expect(
      redactForOutput(
        {
          receipt: {
            request: { params: { user_id: 123456 } },
            response: { status: 204 }
          }
        },
        ['123456']
      )
    ).toEqual({
      receipt: {
        request: { params: { user_id: '[REDACTED]' } },
        response: { status: 204 }
      }
    });
  });

  it('rejects unknown root fields, invalid names and non-table targets', () => {
    expect(captureError(() => parsePushConfig({ version: 1, adapters: {} })))
      .toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Unknown configuration root field "version".",
        "name": "PushError",
      }
    `);
    expect(
      captureError(() =>
        parsePushConfig({
          adapters: { 'bad.name': { type: 'webhook', url: 'https://example.com' } }
        })
      )
    ).toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Adapter names must start with a letter or digit and use only letters, digits, _ or -.",
        "name": "PushError",
      }
    `);
    expect(
      captureError(() =>
        parsePushConfig({
          adapters: {
            webhook: { type: 'webhook', url: 'https://example.com', targets: { 'bad:name': {} } }
          }
        })
      )
    ).toMatchInlineSnapshot(`
      {
        "code": "INVALID_CONFIG",
        "message": "Target names must start with a letter or digit and use only letters, digits, _ or -.",
        "name": "PushError",
      }
    `);
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
