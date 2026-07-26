import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDestinationName, PushError } from '@pushc/core';
import { config as loadDotenv } from 'dotenv';
import { parse } from 'smol-toml';

import { ConfigError } from './error.js';
import { isNonEmptyString, isRecord } from './utils/value.js';

export interface LoadedConfig {
  path: string;
  config: unknown;
  redactions: readonly string[];
}

export interface FindConfigPathOptions {
  config?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  cwd?: string;
}

export interface LoadConfigOptions {
  path: string;
  env?: NodeJS.ProcessEnv;
}

export interface PushAdapterConfigDefinition {
  type: string;
  options: Readonly<Record<string, unknown>>;
  targets: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface PushConfig {
  adapters: Readonly<Record<string, PushAdapterConfigDefinition>>;
}

export async function findConfigPath(options: FindConfigPathOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const home = options.homeDir ?? homedir();

  if (options.config) {
    return await normalizeConfigPath(options.config, cwd, '--config');
  }
  if (env.PUSHC_CONFIG) {
    return await normalizeConfigPath(env.PUSHC_CONFIG, cwd, 'PUSHC_CONFIG');
  }

  const candidates = [
    resolve(cwd, '.pushc', 'config.toml'),
    ...(env.XDG_CONFIG_HOME ? [join(env.XDG_CONFIG_HOME, 'pushc', 'config.toml')] : []),
    join(home, '.config', 'pushc', 'config.toml')
  ];
  for (const candidate of new Set(candidates)) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }

  throw new ConfigError(
    'CONFIG_NOT_FOUND',
    `No pushc config found. Pass --config or create ${join(home, '.config', 'pushc', 'config.toml')}.`
  );
}

export async function normalizeConfigPath(
  input: string,
  cwd = process.cwd(),
  source = 'config path'
): Promise<string> {
  const candidate = resolve(cwd, input);
  let file = candidate;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      file = join(candidate, 'config.toml');
    } else if (!info.isFile()) {
      throw new ConfigError('CONFIG_INVALID', `Config from ${source} is not a file: ${candidate}.`);
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(
      'CONFIG_NOT_FOUND',
      `Config from ${source} does not exist: ${candidate}.`,
      {
        cause: error
      }
    );
  }

  if (!(await isFile(file))) {
    throw new ConfigError('CONFIG_NOT_FOUND', `Config from ${source} does not exist: ${file}.`);
  }
  return file;
}

export async function loadConfig(options: LoadConfigOptions): Promise<LoadedConfig> {
  const env = options.env ?? process.env;
  const path = resolve(options.path);
  if (!(await isFile(path))) {
    throw new ConfigError('CONFIG_NOT_FOUND', `Config file does not exist: ${path}.`);
  }

  const dotenvPath = join(dirname(path), '.env');
  if (await isFile(dotenvPath)) {
    const dotenvResult = loadDotenv({
      path: dotenvPath,
      override: false,
      quiet: true,
      processEnv: env
    });
    if (dotenvResult.error) {
      throw new ConfigError('CONFIG_READ_FAILED', `Could not read ${dotenvPath}.`, {
        cause: dotenvResult.error
      });
    }
  }

  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new ConfigError('CONFIG_READ_FAILED', `Could not read ${path}.`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    throw new ConfigError('CONFIG_INVALID', `Could not parse TOML config at ${path}.`, {
      cause: error
    });
  }

  const redactions = new Set<string>();
  return {
    path,
    config: expandEnvironment(parsed, env, redactions),
    redactions: [...redactions].sort((a, b) => b.length - a.length)
  };
}

export function parsePushConfig(input: unknown): PushConfig {
  const root = configRecord(input, 'Configuration root must be a table.');
  for (const field of Object.keys(root)) {
    if (field !== 'adapters') {
      throw new PushError('INVALID_CONFIG', `Unknown configuration root field "${field}".`);
    }
  }

  const adapterInputs = configRecord(root.adapters, 'adapters must be a table.');
  const adapterEntries: Array<[string, PushAdapterConfigDefinition]> = [];

  for (const [name, inputAdapter] of Object.entries(adapterInputs)) {
    validateDestinationName(name, 'Adapter');
    const adapter = configRecord(inputAdapter, `adapters.${name} must be a table.`);
    if (!isNonEmptyString(adapter.type)) {
      throw new PushError('INVALID_CONFIG', `adapters.${name}.type must be a non-empty string.`);
    }
    const targetInputs =
      adapter.targets === undefined
        ? {}
        : configRecord(adapter.targets, `adapters.${name}.targets must be a table.`);
    const targetEntries: Array<[string, Readonly<Record<string, unknown>>]> = [];
    for (const [targetName, inputTarget] of Object.entries(targetInputs)) {
      validateDestinationName(targetName, 'Target');
      const target = configRecord(
        inputTarget,
        `adapters.${name}.targets.${targetName} must be a table.`
      );
      targetEntries.push([targetName, target]);
    }

    const { type, targets: _targets, ...options } = adapter;
    adapterEntries.push([
      name,
      {
        type: type.trim(),
        options,
        targets: Object.fromEntries(targetEntries)
      }
    ]);
  }

  return {
    adapters: Object.fromEntries(adapterEntries)
  };
}

function expandEnvironment(
  input: unknown,
  env: NodeJS.ProcessEnv,
  redactions: Set<string>
): unknown {
  if (typeof input === 'string') {
    let expanded = false;
    const value = input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      const value = env[name];
      if (value === undefined) {
        throw new ConfigError(
          'ENV_MISSING',
          `Environment variable ${name} is required by the config.`
        );
      }
      expanded = true;
      trackRedaction(redactions, value);
      return value;
    });
    if (expanded) trackRedaction(redactions, value);
    return value;
  }
  if (Array.isArray(input)) {
    return input.map((item) => expandEnvironment(item, env, redactions));
  }
  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, expandEnvironment(value, env, redactions)])
    );
  }
  return input;
}

function trackRedaction(redactions: Set<string>, value: string): void {
  for (const candidate of new Set([value, value.trim()])) {
    if (candidate === '') continue;
    redactions.add(candidate);
    redactions.add(encodeURI(candidate));
    redactions.add(encodeURIComponent(candidate));
    try {
      redactions.add(new URL(candidate).toString());
    } catch {
      // Most configuration strings are not complete URLs.
    }
  }
}

function configRecord(input: unknown, message: string): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new PushError('INVALID_CONFIG', message);
  }
  return input;
}

function validateDestinationName(name: string, label: string): void {
  if (!isDestinationName(name)) {
    throw new PushError(
      'INVALID_CONFIG',
      `${label} names must start with a letter or digit and use only letters, digits, _ or -.`
    );
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
