import type { PushAdapterSendInput, PushMessage } from './types.js';

import { PushError } from './error.js';
import { PushTargets } from './targets.js';

export interface AdapterSendContext<TTarget> {
  message: PushMessage;
  target: TTarget;
  signal?: AbortSignal;
}

export abstract class PushAdapter<
  TConfig = unknown,
  TTarget extends object = Record<string, unknown>,
  TReceipt = unknown
> {
  readonly config: TConfig;
  readonly targets: PushTargets<TTarget>;

  protected constructor(config: TConfig) {
    this.config = config;
    this.targets = new PushTargets(this);
  }

  initialize?(): Promise<void>;

  destroy?(): Promise<void>;

  async send({ target, message, signal }: PushAdapterSendInput<TTarget>): Promise<TReceipt> {
    if (!message || typeof message.content !== 'string' || message.content.trim().length === 0) {
      throw new PushError('INVALID_MESSAGE', 'Message content must not be empty.');
    }
    if (signal?.aborted) {
      throw new PushError('SEND_FAILED', 'Message delivery was aborted.', {
        cause: signal.reason
      });
    }

    return await this.sendTarget({
      message,
      target: this.targets.resolve(target),
      signal
    });
  }

  abstract parseTarget(input: unknown): TTarget;

  protected abstract sendTarget(context: AdapterSendContext<TTarget>): Promise<TReceipt>;
}
