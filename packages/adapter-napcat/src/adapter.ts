import {
  PushAdapter,
  type PushAdapterSendResult,
  type PushPayload,
  type PushSendOptions
} from '@pushc/core';

import type {
  CreateNapCatAdapterOptions,
  NapCatConfig,
  NapCatReceipt,
  NapCatRequestReceipt,
  NapCatSendMessageParams,
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

  protected async sendTarget(
    target: NapCatTargetConfig,
    payload: PushPayload,
    options: Readonly<PushSendOptions>
  ): Promise<PushAdapterSendResult<NapCatReceipt>> {
    const params: NapCatSendMessageParams = {
      ...('user_id' in target
        ? { user_id: Number(target.user_id) }
        : { group_id: Number(target.group_id) }),
      message: [{ type: 'text', data: { text: payload.message } }]
    };
    const request: NapCatRequestReceipt = {
      method: 'send_msg',
      params
    };
    const operation = createOperationSignal(
      [options.signal, this.#connection.destroySignal],
      this.config.timeout_ms
    );
    try {
      const client = await raceWithSignal(
        this.#connection.connect(),
        operation.signal,
        this.config.timeout_ms
      );
      const response = await raceWithSignal(
        client.send_msg(request.params),
        operation.signal,
        this.config.timeout_ms
      );
      const messageId = String(response.message_id);
      const recipient =
        'user_id' in request.params
          ? `user ${request.params.user_id}`
          : `group ${request.params.group_id}`;
      return {
        success: true,
        receipt: {
          summary: `NapCat sent a message to ${recipient} (message ID: ${messageId}).`,
          request,
          response: { messageId }
        }
      };
    } catch (error) {
      return {
        success: false,
        receipt: { request },
        error: {
          code: 'SEND_FAILED',
          message: napCatFailureMessage(error)
        }
      };
    } finally {
      operation.cleanup();
    }
  }

  destroy(): Promise<void> {
    return this.#connection.destroy();
  }
}

function napCatFailureMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    try {
      const message = Reflect.get(error, 'message');
      if (typeof message === 'string' && message) return message;
    } catch {
      // Fall back when an exotic error object exposes a throwing message getter.
    }
  }
  return 'NapCat failed to deliver the message.';
}
