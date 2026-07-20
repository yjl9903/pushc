import { PushAdapter, type AdapterSendContext } from '@pushc/core';

import type {
  CreateNapCatAdapterOptions,
  NapCatConfig,
  NapCatReceipt,
  NapCatTargetConfig
} from './types.js';

import { NapCatConnection } from './client.js';
import { parseNapCatConfig } from './config.js';
import { createOperationSignal, raceWithSignal } from './operation.js';
import { napCatTargetDefaults, parseNapCatTarget, parseNapCatTargetPartial } from './target.js';

export class NapCatAdapter extends PushAdapter<NapCatConfig, NapCatTargetConfig, NapCatReceipt> {
  readonly #connection: NapCatConnection;
  readonly #targetDefaults: Readonly<Record<string, unknown>>;

  constructor(config: unknown, options: CreateNapCatAdapterOptions = {}) {
    super(parseNapCatConfig(config));
    this.#targetDefaults = napCatTargetDefaults(config);
    this.#connection = new NapCatConnection(this.config, options.factory);
  }

  parseTarget(input: unknown): NapCatTargetConfig {
    return parseNapCatTarget({
      ...this.#targetDefaults,
      ...parseNapCatTargetPartial(input)
    });
  }

  protected async sendTarget({ target, message, signal }: AdapterSendContext<NapCatTargetConfig>) {
    const operation = createOperationSignal(
      [signal, this.#connection.destroySignal],
      this.config.timeout_ms
    );
    try {
      const client = await raceWithSignal(
        this.#connection.connect(),
        operation.signal,
        this.config.timeout_ms
      );
      const response = await raceWithSignal(
        client.send_msg({
          ...('user_id' in target
            ? { user_id: Number(target.user_id) }
            : { group_id: Number(target.group_id) }),
          message: [{ type: 'text', data: { text: message.content } }]
        }),
        operation.signal,
        this.config.timeout_ms
      );
      return { messageId: String(response.message_id) };
    } finally {
      operation.cleanup();
    }
  }

  destroy(): Promise<void> {
    return this.#connection.destroy();
  }
}
