import type { PushAdapter } from './adapter.js';
import type { PushTargetInput } from './types.js';

import { PushError } from './error.js';
import { isRecord } from './utils/value.js';
import { errorMessage } from './utils/error.js';
import { isDestinationName, validateDestinationName } from './utils/destination.js';

type AnyTargetAdapter<TTarget extends object> = PushAdapter<any, TTarget, any>;

export class PushTargets<TTarget extends object> implements Iterable<[string, TTarget]> {
  readonly #adapter: AnyTargetAdapter<TTarget>;
  readonly #items = new Map<string, TTarget>();

  constructor(adapter: AnyTargetAdapter<TTarget>) {
    this.#adapter = adapter;
  }

  get size(): number {
    return this.#items.size;
  }

  get(name: string): TTarget | undefined {
    return this.#items.get(name);
  }

  register(name: string, partial: Readonly<Record<string, unknown>>): this {
    validateDestinationName(name, 'Target');
    if (this.#items.has(name)) {
      throw new PushError('DUPLICATE_TARGET', `Target "${name}" is already registered.`);
    }
    this.#items.set(name, this.#parse(`Target "${name}"`, partial));
    return this;
  }

  resolve(input?: PushTargetInput): TTarget {
    if (typeof input === 'string') {
      if (!isDestinationName(input)) {
        throw new PushError(
          'INVALID_TARGET',
          'Target names must use only letters, digits, _ or -.'
        );
      }
      if (!this.#items.has(input)) {
        throw new PushError('TARGET_NOT_FOUND', `Target "${input}" is not defined.`);
      }
      return this.#items.get(input) as TTarget;
    }

    return this.#parse(input === undefined ? 'Default target' : 'Temporary target', input ?? {});
  }

  has(name: string): boolean {
    return this.#items.has(name);
  }

  delete(name: string): boolean {
    return this.#items.delete(name);
  }

  clear(): void {
    this.#items.clear();
  }

  keys(): MapIterator<string> {
    return this.#items.keys();
  }

  values(): MapIterator<TTarget> {
    return this.#items.values();
  }

  entries(): MapIterator<[string, TTarget]> {
    return this.#items.entries();
  }

  forEach(
    callback: (value: TTarget, key: string, map: PushTargets<TTarget>) => void,
    thisArg?: unknown
  ): void {
    for (const [name, target] of this.#items) {
      callback.call(thisArg, target, name, this);
    }
  }

  [Symbol.iterator](): MapIterator<[string, TTarget]> {
    return this.entries();
  }

  #parse(label: string, input: unknown): TTarget {
    if (!isRecord(input)) {
      throw new PushError('INVALID_CONFIG', `${label} must be an object.`);
    }
    try {
      return this.#adapter.parseTarget(input);
    } catch (error) {
      if (error instanceof PushError) {
        throw error;
      }
      throw new PushError(
        'INVALID_CONFIG',
        `Invalid configuration for ${label.toLowerCase()}: ${errorMessage(error)}`,
        { cause: error }
      );
    }
  }
}
