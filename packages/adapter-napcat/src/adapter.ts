import { addAbortListener } from 'node:events';
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
import { napCatTargetDefaults, parseNapCatTarget, parseNapCatTargetPartial } from './target.js';

export class NapCatAdapter extends PushAdapter<NapCatConfig, NapCatTargetConfig, NapCatReceipt> {
  readonly #connection: NapCatConnection;
  readonly #targetDefaults: Readonly<Record<string, unknown>>;

  public constructor(config: unknown, options: CreateNapCatAdapterOptions = {}) {
    super(parseNapCatConfig(config));
    this.#targetDefaults = napCatTargetDefaults(config);
    this.#connection = new NapCatConnection(this.config, options.factory);
  }

  public parseTarget(input: unknown): NapCatTargetConfig {
    return parseNapCatTarget({
      ...this.#targetDefaults,
      ...parseNapCatTargetPartial(input)
    });
  }

  protected prepareRequest(target: NapCatTargetConfig, payload: PushPayload): NapCatRequestReceipt {
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
    return request;
  }

  protected async sendRequest(
    request: NapCatRequestReceipt,
    options: Readonly<PushSendOptions>
  ): Promise<PushAdapterSendResult<NapCatReceipt>> {
    const timeoutSignal = AbortSignal.timeout(this.config.timeout_ms);
    const operationSignal = AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      this.#connection.destroySignal,
      timeoutSignal
    ]);
    const aborted = Promise.withResolvers<never>();
    const abortOperation = () => aborted.reject(operationSignal.reason);
    using abortSubscription = addAbortListener(operationSignal, abortOperation);
    if (operationSignal.aborted) abortOperation();

    try {
      const client = await Promise.race([aborted.promise, this.#connection.connect()]);
      const response = await Promise.race([aborted.promise, client.send_msg(request.params)]);
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
          message:
            timeoutSignal.aborted && error === timeoutSignal.reason
              ? `NapCat operation timed out after ${this.config.timeout_ms}ms.`
              : operationSignal.aborted && error === operationSignal.reason
                ? 'NapCat operation was aborted.'
                : napCatFailureMessage(error)
        }
      };
    }
  }

  public destroy(): Promise<void> {
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
  return 'NapCat failed to send the message.';
}
