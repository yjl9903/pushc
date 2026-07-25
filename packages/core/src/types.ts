export interface PushPayload {
  readonly message: string;
  readonly title?: string;
  readonly param?: Readonly<Record<string, string>>;
}

export interface PushSendOptions {
  readonly dryRun?: boolean;
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

export interface PushResultError {
  readonly code: string;
  readonly message: string;
}

export type PushAdapterSendResult<TReceipt extends PushReceipt = PushReceipt> =
  | {
      readonly success: true;
      readonly receipt: TReceipt;
    }
  | {
      readonly success: false;
      readonly receipt?: TReceipt;
      readonly error: PushResultError;
    };

export type PushAdapterDryRunResult<TReceipt extends PushReceipt = PushReceipt> =
  PushAdapterSendResult<Pick<TReceipt, 'request'>> & {
    readonly dryRun: true;
  };

export type PushResult<TReceipt extends PushReceipt = PushReceipt> =
  | {
      readonly success: true;
      readonly adapter: string;
      readonly target?: string;
      readonly receipt: TReceipt;
    }
  | {
      readonly success: false;
      readonly adapter?: string;
      readonly target?: string;
      readonly receipt?: TReceipt;
      readonly error: PushResultError;
    };

export type PushDryRunResult<TReceipt extends PushReceipt = PushReceipt> = PushResult<
  Pick<TReceipt, 'request' | 'summary'>
> & {
  readonly dryRun: true;
};
