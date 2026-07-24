import type { PushDestination, PushPayload, PushResult, PushSendOptions } from './types.js';

import { PushError } from './error.js';
import { PushAdapters } from './adapters.js';
import { errorMessage } from './utils/error.js';
import { normalizeDestination } from './utils/destination.js';

export class PushClient {
  readonly adapters: PushAdapters;
  #destroyed = false;
  #destroyPromise?: Promise<void>;

  constructor() {
    this.adapters = new PushAdapters();
  }

  async send(
    destination: PushDestination,
    payload: PushPayload,
    options?: PushSendOptions
  ): Promise<PushResult> {
    if (this.#destroyed) {
      throw new PushError('CLIENT_DESTROYED', 'PushClient has been destroyed.');
    }

    const normalizedDestination = normalizeDestination(destination);
    const selectedAdapter = this.adapters.get(normalizedDestination.adapter);
    if (!selectedAdapter) {
      throw new PushError(
        'ADAPTER_NOT_FOUND',
        `Adapter "${normalizedDestination.adapter}" is not defined.`
      );
    }
    try {
      const receipt = await selectedAdapter.send(normalizedDestination.target, payload, options);
      return {
        adapter: normalizedDestination.adapter,
        ...(typeof normalizedDestination.target === 'string'
          ? { target: normalizedDestination.target }
          : {}),
        receipt
      };
    } catch (error) {
      if (error instanceof PushError) {
        throw error;
      }
      throw new PushError(
        'SEND_FAILED',
        `Adapter "${normalizedDestination.adapter}" failed to deliver the message: ${errorMessage(error)}`,
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
