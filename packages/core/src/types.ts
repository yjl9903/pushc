export interface PushPayload {
  readonly message: string;
  readonly title?: string;
  readonly param?: Readonly<Record<string, string>>;
}

export interface PushSendOptions {
  readonly signal?: AbortSignal;
}

export type PushTargetInput = string | Readonly<Record<string, unknown>>;

export type PushDestination =
  | string
  | {
      readonly adapter: string;
      readonly target?: PushTargetInput;
    };

export interface PushResult<TReceipt = unknown> {
  readonly adapter: string;
  readonly target?: string;
  readonly receipt: TReceipt;
}
