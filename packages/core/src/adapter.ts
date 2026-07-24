import type { PushPayload, PushSendOptions, PushTargetInput } from './types.js';

import { PushError } from './error.js';
import { PushTargets } from './targets.js';
import { normalizePayload, normalizeSendOptions } from './validation.js';

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

  async send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options?: PushSendOptions
  ): Promise<TReceipt> {
    const normalizedPayload = normalizePayload(payload);
    const normalizedOptions = normalizeSendOptions(options);
    if (normalizedOptions.signal?.aborted) {
      throw new PushError('SEND_FAILED', 'Message delivery was aborted.', {
        cause: normalizedOptions.signal.reason
      });
    }

    return await this.sendTarget(
      this.targets.resolve(target),
      normalizedPayload,
      normalizedOptions
    );
  }

  abstract parseTarget(input: unknown): TTarget;

  protected abstract sendTarget(
    target: TTarget,
    payload: PushPayload,
    options: Readonly<PushSendOptions>
  ): Promise<TReceipt>;
}
