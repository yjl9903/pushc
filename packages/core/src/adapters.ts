import { PushError } from './error.js';
import { PushAdapter } from './adapter.js';
import { validateDestinationName } from './utils/destination.js';

export type AnyPushAdapter = PushAdapter<any, any, any>;

export class PushAdapters implements Iterable<[string, AnyPushAdapter]> {
  readonly #items = new Map<string, AnyPushAdapter>();

  get size(): number {
    return this.#items.size;
  }

  get(name: string): AnyPushAdapter | undefined {
    return this.#items.get(name);
  }

  register(name: string, adapter: AnyPushAdapter): this {
    validateDestinationName(name, 'Adapter');
    if (this.#items.has(name)) {
      throw new PushError('DUPLICATE_ADAPTER', `Adapter "${name}" is already registered.`);
    }
    if (!(adapter instanceof PushAdapter)) {
      throw new PushError('INVALID_CONFIG', 'Adapter values must extend PushAdapter.');
    }
    this.#items.set(name, adapter);
    return this;
  }

  has(name: string): boolean {
    return this.#items.has(name);
  }

  async delete(name: string): Promise<boolean> {
    const adapter = this.#items.get(name);
    if (!adapter) return false;
    this.#items.delete(name);
    try {
      await adapter.destroy?.();
    } catch (error) {
      throw new PushError('DESTROY_FAILED', `Adapter "${name}" failed to destroy.`, {
        cause: error
      });
    }
    return true;
  }

  async clear(): Promise<void> {
    const adapters = [...this.#items.values()];
    this.#items.clear();
    const results = await Promise.allSettled(adapters.map((adapter) => adapter.destroy?.()));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new PushError(
        'DESTROY_FAILED',
        `${failures.length} adapter${failures.length === 1 ? '' : 's'} failed to destroy.`,
        { cause: failures[0].reason }
      );
    }
  }

  keys(): MapIterator<string> {
    return this.#items.keys();
  }

  values(): MapIterator<AnyPushAdapter> {
    return this.#items.values();
  }

  entries(): MapIterator<[string, AnyPushAdapter]> {
    return this.#items.entries();
  }

  forEach(
    callback: (value: AnyPushAdapter, key: string, map: PushAdapters) => void,
    thisArg?: unknown
  ): void {
    for (const [name, adapter] of this.#items) {
      callback.call(thisArg, adapter, name, this);
    }
  }

  [Symbol.iterator](): MapIterator<[string, AnyPushAdapter]> {
    return this.entries();
  }
}
