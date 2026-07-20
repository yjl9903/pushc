import { NapCatError } from './error.js';

const timeoutReason = Symbol('timeout');

export function createOperationSignal(
  parents: readonly (AbortSignal | undefined)[],
  timeoutMs: number
) {
  const controller = new AbortController();
  const listeners: Array<[AbortSignal, () => void]> = [];
  for (const parent of parents) {
    if (!parent) continue;
    const abortFromParent = () => controller.abort(parent.reason);
    if (parent.aborted) {
      abortFromParent();
      break;
    }
    parent.addEventListener('abort', abortFromParent, { once: true });
    listeners.push([parent, abortFromParent]);
  }
  const timer = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      for (const [parent, listener] of listeners) {
        parent.removeEventListener('abort', listener);
      }
    }
  };
}

export async function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    throw abortError(signal.reason, timeoutMs);
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal.reason, timeoutMs));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function abortError(reason: unknown, timeoutMs: number): NapCatError {
  return new NapCatError(
    'ABORTED',
    reason === timeoutReason
      ? `NapCat operation timed out after ${timeoutMs}ms.`
      : 'NapCat operation was aborted.'
  );
}
