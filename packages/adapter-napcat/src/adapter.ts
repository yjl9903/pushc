import { addAbortListener } from 'node:events';
import {
  PushAdapter,
  type NormalizedPushPayload,
  type PushAdapterOperationOptions,
  type PushDispatchResult
} from '@pushc/core';

import type {
  CreateNapCatAdapterOptions,
  NapCatConfig,
  NapCatRequestReceipt,
  NapCatResponseReceipt,
  NapCatTargetConfig,
  NapCatTransportRequest
} from './types.js';

import { NapCatConnection } from './client.js';
import { parseNapCatConfig } from './config.js';
import {
  prepareNapCatRequest,
  updateNapCatRemoteMediaTypes,
  type PreparedNapCatRequest
} from './request.js';
import { napCatTargetDefaults, parseNapCatTarget, parseNapCatTargetPartial } from './target.js';

export class NapCatAdapter extends PushAdapter<
  NapCatConfig,
  NapCatTargetConfig,
  NapCatRequestReceipt,
  NapCatResponseReceipt,
  NapCatTransportRequest
> {
  readonly #connection: NapCatConnection;
  readonly #fetch: typeof globalThis.fetch;
  readonly #targetDefaults: Readonly<Record<string, unknown>>;

  public constructor(config: unknown, options: CreateNapCatAdapterOptions = {}) {
    super(parseNapCatConfig(config));
    this.#targetDefaults = napCatTargetDefaults(config);
    this.#connection = new NapCatConnection(this.config, options.factory);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public parseTarget(input: unknown): NapCatTargetConfig {
    return parseNapCatTarget({
      ...this.#targetDefaults,
      ...parseNapCatTargetPartial(input)
    });
  }

  protected prepareRequest(
    target: NapCatTargetConfig,
    payload: NormalizedPushPayload,
    options: PushAdapterOperationOptions
  ): Promise<PreparedNapCatRequest> {
    return prepareNapCatRequest(target, payload, this.config.max_attachment_bytes, options);
  }

  protected async dispatchRequest(
    prepared: PreparedNapCatRequest,
    options: PushAdapterOperationOptions
  ): Promise<PushDispatchResult<NapCatRequestReceipt, NapCatResponseReceipt>> {
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
      await Promise.race([
        aborted.promise,
        updateNapCatRemoteMediaTypes(this.#fetch, prepared, operationSignal)
      ]);

      const client = await Promise.race([aborted.promise, this.#connection.connect()]);

      const response = await Promise.race([
        aborted.promise,
        client.send_msg(prepared.transportRequest.params)
      ]);

      const messageId = String(response.message_id);
      const recipient =
        'user_id' in prepared.transportRequest.params
          ? `user ${prepared.transportRequest.params.user_id}`
          : `group ${prepared.transportRequest.params.group_id}`;

      return {
        success: true,
        request: prepared.receiptRequest,
        summary: `NapCat sent a message to ${recipient} (message ID: ${messageId}).`,
        response: { messageId }
      };
    } catch (error) {
      return {
        success: false,
        request: prepared.receiptRequest,
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
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'NapCat failed to send the message.';
}
