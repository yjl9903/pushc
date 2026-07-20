export interface PushMessage {
  content: string;
}

export type PushTargetInput<TTarget extends object = Record<string, unknown>> =
  string | Partial<TTarget>;

export interface PushAdapterSendInput<TTarget extends object = Record<string, unknown>> {
  target?: PushTargetInput<TTarget>;
  message: PushMessage;
  signal?: AbortSignal;
}

export interface PushResult<TReceipt = unknown> {
  adapter: string;
  target?: string;
  receipt: TReceipt;
}

export interface PushClientSendInput {
  adapter: string;
  target?: string | object;
  message: PushMessage;
  signal?: AbortSignal;
}
