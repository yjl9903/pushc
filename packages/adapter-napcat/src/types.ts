import type { PushReceipt } from '@pushc/core';

export interface NapCatConfig {
  base_url: string;
  access_token?: string;
  timeout_ms: number;
  max_attachment_bytes: number;
}

export type NapCatTargetConfig =
  { user_id: string; group_id?: never } | { user_id?: never; group_id: string };

export interface NapCatTextSegment {
  readonly type: 'text';
  readonly data: { readonly text: string };
}

export type NapCatAttachmentSegmentType = 'image' | 'record' | 'video' | 'file';

export type NapCatAttachmentReceiptData =
  | {
      readonly name: string;
      readonly media_type: string;
      readonly size: number;
      readonly sha256: string;
      readonly encoding: 'base64';
    }
  | {
      readonly name: string;
      readonly media_type: string;
      readonly host: string;
      readonly encoding: 'url';
    };

export interface NapCatAttachmentReceiptSegment {
  readonly type: NapCatAttachmentSegmentType;
  readonly data: NapCatAttachmentReceiptData;
}

export interface NapCatAttachmentTransportSegment {
  readonly type: NapCatAttachmentSegmentType;
  readonly data: {
    readonly file: string;
    readonly name?: string;
  };
}

export type NapCatReceiptMessageSegment = NapCatTextSegment | NapCatAttachmentReceiptSegment;
export type NapCatTransportMessageSegment = NapCatTextSegment | NapCatAttachmentTransportSegment;

export type NapCatSendMessageParams = (
  { readonly user_id: number } | { readonly group_id: number }
) & {
  readonly message: NapCatTransportMessageSegment[];
};

export type NapCatRequestReceiptParams = (
  { readonly user_id: number } | { readonly group_id: number }
) & {
  readonly message: NapCatReceiptMessageSegment[];
};

export interface NapCatRequestReceipt {
  readonly method: 'send_msg';
  readonly params: NapCatRequestReceiptParams;
}

export interface NapCatTransportRequest {
  readonly method: 'send_msg';
  readonly params: NapCatSendMessageParams;
}

export interface NapCatResponseReceipt {
  readonly messageId: string;
}

export type NapCatReceipt = PushReceipt<NapCatRequestReceipt, NapCatResponseReceipt>;

export interface NapCatClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send_msg(params: NapCatSendMessageParams): Promise<{ message_id: number | string }>;
}

export interface NapCatClientOptions {
  baseUrl: string;
  accessToken?: string;
  apiTimeout: number;
}

export type NapCatFactory = (options: NapCatClientOptions) => NapCatClient;

export interface CreateNapCatAdapterOptions {
  fetch?: typeof globalThis.fetch;
  factory?: NapCatFactory;
}
