import type {
  PushAdapterDryRunResult,
  PushAdapterSendResult,
  PushPayload,
  PushReceipt,
  PushSendOptions,
  PushTargetInput
} from './types.js';

import { PushError } from './error.js';
import { PushTargets } from './targets.js';
import { normalizePayload, normalizeSendOptions } from './validation.js';

export abstract class PushAdapter<
  TConfig = unknown,
  TTarget extends object = Record<string, unknown>,
  TReceipt extends PushReceipt = PushReceipt
> {
  readonly config: TConfig;
  readonly targets: PushTargets<TTarget>;

  protected constructor(config: TConfig) {
    this.config = config;
    this.targets = new PushTargets(this);
  }

  public destroy?(): Promise<void>;

  public abstract parseTarget(input: unknown): TTarget;

  protected abstract prepareRequest(target: TTarget, payload: PushPayload): TReceipt['request'];

  protected abstract sendRequest(
    request: TReceipt['request'],
    options: Readonly<PushSendOptions>
  ): Promise<PushAdapterSendResult<TReceipt>>;

  public async send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options: PushSendOptions & { readonly dryRun: true }
  ): Promise<PushAdapterDryRunResult<TReceipt>>;
  public async send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options?: PushSendOptions & { readonly dryRun?: false }
  ): Promise<PushAdapterSendResult<TReceipt>>;
  public async send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options?: PushSendOptions
  ): Promise<PushAdapterSendResult<TReceipt> | PushAdapterDryRunResult<TReceipt>>;
  public async send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options?: PushSendOptions
  ): Promise<PushAdapterSendResult<TReceipt> | PushAdapterDryRunResult<TReceipt>> {
    const dryRun = options?.dryRun === true;

    try {
      const normalizedPayload = normalizePayload(payload);
      const normalizedOptions = normalizeSendOptions(options);
      if (normalizedOptions.signal?.aborted) {
        throw new PushError('SEND_FAILED', 'Message sending was aborted.', {
          cause: normalizedOptions.signal.reason
        });
      }

      const request = this.prepareRequest(this.targets.resolve(target), normalizedPayload);
      if (dryRun) {
        return { dryRun: true, success: true, receipt: { request } };
      } else {
        return await this.sendRequest(request, normalizedOptions);
      }
    } catch (error) {
      const failure = {
        success: false as const,
        error: {
          code: error instanceof PushError ? error.code : 'SEND_FAILED',
          message:
            error instanceof Error && error.message
              ? error.message
              : dryRun
                ? 'Message preparation failed.'
                : 'Message sending failed.'
        }
      };

      if (dryRun) {
        return { dryRun: true, ...failure };
      } else {
        return failure;
      }
    }
  }
}
