import type {
  PushAdapterOperationOptions,
  PushAdapterDryRunResult,
  PushAdapterSendResult,
  PushDispatchResult,
  NormalizedPushPayload,
  PushPayload,
  PushPreparedRequest,
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
  TReceiptRequest = unknown,
  TReceiptResponse = unknown,
  TTransportRequest = TReceiptRequest
> {
  readonly config: TConfig;
  readonly targets: PushTargets<TTarget>;

  protected constructor(config: TConfig) {
    this.config = config;
    this.targets = new PushTargets(this);
  }

  public destroy?(): Promise<void>;

  public abstract parseTarget(input: unknown): TTarget;

  protected abstract prepareRequest(
    target: TTarget,
    payload: NormalizedPushPayload,
    options: PushAdapterOperationOptions
  ): Promise<PushPreparedRequest<TReceiptRequest, TTransportRequest>>;

  protected abstract dispatchRequest(
    prepared: PushPreparedRequest<TReceiptRequest, TTransportRequest>,
    options: PushAdapterOperationOptions
  ): Promise<PushDispatchResult<TReceiptRequest, TReceiptResponse>>;

  async #dispatch(
    prepared: PushPreparedRequest<TReceiptRequest, TTransportRequest>,
    options: PushAdapterOperationOptions
  ): Promise<PushAdapterSendResult<PushReceipt<TReceiptRequest, TReceiptResponse>>> {
    try {
      const result = await this.dispatchRequest(prepared, options);

      const receipt: PushReceipt<TReceiptRequest, TReceiptResponse> = {
        request: result.request ?? prepared.receiptRequest,
        ...(result.response === undefined ? {} : { response: result.response }),
        ...(result.success && result.summary !== undefined ? { summary: result.summary } : {})
      };

      if (result.success) {
        return { success: true, receipt };
      } else {
        return {
          success: false,
          receipt,
          error: {
            code: result.error.code,
            message: result.error.message
          }
        };
      }
    } catch (error) {
      return {
        success: false,
        receipt: { request: prepared.receiptRequest },
        error: {
          code: 'SEND_FAILED',
          message:
            error instanceof Error && error.message ? error.message : 'Message sending failed.'
        }
      };
    }
  }

  public async send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options: PushSendOptions & { readonly dryRun: true }
  ): Promise<PushAdapterDryRunResult<PushReceipt<TReceiptRequest, TReceiptResponse>>>;
  public async send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options?: PushSendOptions & { readonly dryRun?: false }
  ): Promise<PushAdapterSendResult<PushReceipt<TReceiptRequest, TReceiptResponse>>>;
  public async send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options?: PushSendOptions
  ): Promise<
    | PushAdapterSendResult<PushReceipt<TReceiptRequest, TReceiptResponse>>
    | PushAdapterDryRunResult<PushReceipt<TReceiptRequest, TReceiptResponse>>
  >;
  public async send(
    target: PushTargetInput | undefined,
    payload: PushPayload,
    options?: PushSendOptions
  ): Promise<
    | PushAdapterSendResult<PushReceipt<TReceiptRequest, TReceiptResponse>>
    | PushAdapterDryRunResult<PushReceipt<TReceiptRequest, TReceiptResponse>>
  > {
    const dryRun = options?.dryRun === true;
    let prepared: PushPreparedRequest<TReceiptRequest, TTransportRequest> | undefined;

    try {
      const normalizedPayload = normalizePayload(payload);
      const normalizedOptions = normalizeSendOptions(options);
      assertNotAborted(normalizedOptions.signal);
      const operationOptions: PushAdapterOperationOptions = Object.freeze({
        ...(normalizedOptions.signal === undefined ? {} : { signal: normalizedOptions.signal })
      });

      prepared = await this.prepareRequest(
        this.targets.resolve(target),
        normalizedPayload,
        operationOptions
      );
      assertNotAborted(normalizedOptions.signal);

      if (dryRun) {
        return {
          dryRun: true,
          success: true,
          receipt: { request: prepared.receiptRequest }
        };
      } else {
        return await this.#dispatch(prepared, operationOptions);
      }
    } catch (error) {
      const failure = {
        ...preparationFailure(error, dryRun),
        ...(prepared === undefined
          ? {}
          : {
              receipt: {
                request: prepared.receiptRequest
              }
            })
      };

      if (dryRun) {
        return { dryRun: true, ...failure };
      } else {
        return failure;
      }
    }
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new PushError('SEND_FAILED', 'Message sending was aborted.', {
    cause: signal.reason
  });
}

function preparationFailure(error: unknown, dryRun: boolean) {
  return {
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
}
