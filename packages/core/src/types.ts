export interface PushPayload {
  readonly message: string;
  readonly attachments?: readonly string[];
  readonly title?: string;
  readonly param?: Readonly<Record<string, string>>;
}

export interface PushSendOptions {
  readonly dryRun?: boolean;
  readonly signal?: AbortSignal;
}

export interface PushAdapterOperationOptions {
  readonly signal?: AbortSignal;
}

export type PushTargetInput = string | Readonly<Record<string, unknown>>;

export type PushDestination =
  | string
  | {
      readonly adapter: string;
      readonly target?: PushTargetInput;
    };

export interface PushReceipt<TRequest = unknown, TResponse = unknown> {
  readonly request: TRequest;
  readonly response?: TResponse;
  readonly summary?: string;
}

export interface PushPreparedRequest<TReceiptRequest, TTransportRequest> {
  readonly receiptRequest: TReceiptRequest;
  readonly transportRequest: TTransportRequest;
}

export interface PushResultError {
  readonly code: string;
  readonly message: string;
}

export type PushDispatchResult<TRequest = never, TResponse = unknown> =
  | {
      readonly success: true;
      readonly request?: TRequest;
      readonly response?: TResponse;
      readonly summary?: string;
    }
  | {
      readonly success: false;
      readonly request?: TRequest;
      readonly response?: TResponse;
      readonly error: PushResultError;
    };

export interface PushAdapterSuccessResult<TReceipt extends PushReceipt = PushReceipt> {
  readonly success: true;
  readonly receipt: TReceipt;
}

export interface PushAdapterFailureResult<TReceipt extends PushReceipt = PushReceipt> {
  readonly success: false;
  readonly receipt?: TReceipt;
  readonly error: PushResultError;
}

export type PushAdapterSendResult<TReceipt extends PushReceipt = PushReceipt> = (
  PushAdapterSuccessResult<TReceipt> | PushAdapterFailureResult<TReceipt>
) & {
  readonly dryRun?: never;
};

export type PushAdapterDryRunResult<TReceipt extends PushReceipt = PushReceipt> = (
  | PushAdapterSuccessResult<Pick<TReceipt, 'request'>>
  | PushAdapterFailureResult<Pick<TReceipt, 'request'>>
) & {
  readonly dryRun: true;
};

export interface PushSuccessResult<TReceipt extends PushReceipt = PushReceipt> {
  readonly success: true;
  readonly adapter: string;
  readonly target?: string;
  readonly receipt: TReceipt;
}

export interface PushFailureResult<TReceipt extends PushReceipt = PushReceipt> {
  readonly success: false;
  readonly adapter?: string;
  readonly target?: string;
  readonly receipt?: TReceipt;
  readonly error: PushResultError;
}

export type PushResult<TReceipt extends PushReceipt = PushReceipt> = (
  PushSuccessResult<TReceipt> | PushFailureResult<TReceipt>
) & { readonly dryRun?: never };

export type PushDryRunResult<TReceipt extends PushReceipt = PushReceipt> = (
  PushSuccessResult<Pick<TReceipt, 'request'>> | PushFailureResult<Pick<TReceipt, 'request'>>
) & { readonly dryRun: true };
