export interface NapCatConfig {
  base_url: string;
  access_token?: string;
  timeout_ms: number;
}

export type NapCatTargetConfig =
  { user_id: string; group_id?: never } | { user_id?: never; group_id: string };

export interface NapCatReceipt {
  messageId: string;
}

export interface NapCatClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send_msg(
    params: ({ user_id: number } | { group_id: number }) & {
      message: Array<{ type: 'text'; data: { text: string } }>;
    }
  ): Promise<{ message_id: number | string }>;
}

export interface NapCatClientOptions {
  baseUrl: string;
  accessToken?: string;
  apiTimeout: number;
}

export type NapCatFactory = (options: NapCatClientOptions) => NapCatClient;

export interface CreateNapCatAdapterOptions {
  factory?: NapCatFactory;
}
