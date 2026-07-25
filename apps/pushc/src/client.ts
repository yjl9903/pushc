import { NapCatAdapter } from '@pushc/adapter-napcat';
import { WebhookAdapter } from '@pushc/adapter-webhook';
import { PushClient, PushError, type AnyPushAdapter } from '@pushc/core';

import { errorMessage } from './utils/error.js';
import {
  findConfigPath,
  loadConfig,
  parsePushConfig,
  type FindConfigPathOptions
} from './config.js';

export type PushRuntime =
  | {
      readonly success: true;
      readonly client: PushClient;
      readonly redactions: readonly string[];
    }
  | {
      readonly success: false;
      readonly error: unknown;
      readonly redactions: readonly string[];
    };

export interface MakePushRuntimeOptions extends FindConfigPathOptions {}

export async function makePushRuntime(options: MakePushRuntimeOptions = {}): Promise<PushRuntime> {
  let redactions: readonly string[] = [];
  try {
    const configFilePath = await findConfigPath(options);
    const loaded = await loadConfig({ path: configFilePath, env: options.env });
    redactions = loaded.redactions;
    const client = await createPushClient(parsePushConfig(loaded.config));
    return { success: true, client, redactions };
  } catch (error) {
    return { success: false, error, redactions };
  }
}

async function createPushClient(config: ReturnType<typeof parsePushConfig>): Promise<PushClient> {
  const client = new PushClient();

  for (const [name, definition] of Object.entries(config.adapters)) {
    let adapter: AnyPushAdapter | undefined;
    try {
      switch (definition.type) {
        case 'webhook': {
          adapter = new WebhookAdapter(definition.options);
          break;
        }
        case 'napcat': {
          adapter = new NapCatAdapter(definition.options);
          break;
        }
        default: {
          throw new PushError(
            'UNKNOWN_ADAPTER',
            `Adapter implementation "${definition.type}" is not supported.`
          );
        }
      }

      const targets = Object.entries(definition.targets);
      if (targets.length === 0) {
        adapter.targets.resolve();
      } else {
        for (const [targetName, partial] of targets) {
          adapter.targets.register(targetName, partial);
        }
      }
      client.adapters.register(name, adapter);
    } catch (error) {
      await adapter?.destroy?.().catch(() => undefined);
      await client.destroy().catch(() => undefined);
      if (error instanceof PushError && error.code === 'UNKNOWN_ADAPTER') {
        throw error;
      }
      throw new PushError(
        'INVALID_CONFIG',
        `Invalid configuration for adapter "${name}": ${errorMessage(error)}`,
        { cause: error }
      );
    }
  }

  return client;
}
