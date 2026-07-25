import type { PushDestination, PushPayload, PushResult, PushSendOptions } from './types.js';

import { PushError } from './error.js';
import { PushAdapters } from './adapters.js';
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
    let adapter: string | undefined;
    let target: string | undefined;
    try {
      if (this.#destroyed) {
        throw new PushError('CLIENT_DESTROYED', 'PushClient has been destroyed.');
      }

      const normalizedDestination = normalizeDestination(destination);
      adapter = normalizedDestination.adapter;
      target =
        typeof normalizedDestination.target === 'string' ? normalizedDestination.target : undefined;
      const selectedAdapter = this.adapters.get(adapter);
      if (!selectedAdapter) {
        throw new PushError('ADAPTER_NOT_FOUND', `Adapter "${adapter}" is not defined.`);
      }

      const result = await selectedAdapter.send(normalizedDestination.target, payload, options);
      if (result.success) {
        return {
          success: true,
          adapter,
          ...(target === undefined ? {} : { target }),
          receipt: result.receipt
        };
      } else {
        return {
          success: false,
          adapter,
          ...(target === undefined ? {} : { target }),
          ...(result.receipt === undefined ? {} : { receipt: result.receipt }),
          error: {
            code: result.error.code,
            message: result.error.message
          }
        };
      }
    } catch (error) {
      return {
        success: false,
        ...(adapter === undefined ? {} : { adapter }),
        ...(target === undefined ? {} : { target }),
        error: {
          code:
            error instanceof PushError ? error.code : adapter ? 'SEND_FAILED' : 'INTERNAL_ERROR',
          message: error instanceof Error && error.message ? error.message : 'Unknown error'
        }
      };
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
