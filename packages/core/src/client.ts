import type { PushClientSendInput, PushResult } from './types.js';

import { PushError } from './error.js';
import { PushAdapters } from './adapters.js';
import { isPushName } from './utils/name.js';
import { errorMessage } from './utils/error.js';

export class PushClient {
  readonly adapters: PushAdapters;
  #destroyed = false;
  #destroyPromise?: Promise<void>;

  constructor() {
    this.adapters = new PushAdapters();
  }

  async send({ adapter, target, message, signal }: PushClientSendInput): Promise<PushResult> {
    if (this.#destroyed) {
      throw new PushError('CLIENT_DESTROYED', 'PushClient has been destroyed.');
    }
    if (!isPushName(adapter)) {
      throw new PushError('INVALID_TARGET', 'A valid adapter name is required.');
    }
    const selectedAdapter = this.adapters.get(adapter);
    if (!selectedAdapter) {
      throw new PushError('ADAPTER_NOT_FOUND', `Adapter "${adapter}" is not defined.`);
    }
    try {
      const receipt = await selectedAdapter.send({
        message,
        target,
        signal
      });
      return {
        adapter,
        ...(typeof target === 'string' ? { target } : {}),
        receipt
      };
    } catch (error) {
      if (error instanceof PushError) {
        throw error;
      }
      throw new PushError(
        'SEND_FAILED',
        `Adapter "${adapter}" failed to deliver the message: ${errorMessage(error)}`,
        { cause: error }
      );
    }
  }

  destroy(): Promise<void> {
    if (this.#destroyPromise) {
      return this.#destroyPromise;
    }
    this.#destroyed = true;
    this.#destroyPromise = this.#destroyAdapters();
    return this.#destroyPromise;
  }

  async #destroyAdapters(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.adapters.values()].map((adapter) => adapter.destroy?.())
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new PushError(
        'DESTROY_FAILED',
        `${failures.length} adapter${failures.length === 1 ? '' : 's'} failed to destroy.`,
        { cause: failures[0].reason }
      );
    }
  }
}
