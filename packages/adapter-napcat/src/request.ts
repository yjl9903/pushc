import type {
  NormalizedPushPayload,
  PushAttachmentContent,
  PushPreparedRequest
} from '@pushc/core';

import type {
  NapCatAttachmentReceiptSegment,
  NapCatAttachmentTransportSegment,
  NapCatRequestReceipt,
  NapCatReceiptMessageSegment,
  NapCatTargetConfig,
  NapCatTransportMessageSegment,
  NapCatTransportRequest
} from './types.js';

import { napCatAttachmentSegmentType, prepareNapCatAttachments } from './attachment.js';

const DEFAULT_REMOTE_PROBE_CONCURRENCY = 8;

interface RemoteProbeCandidate {
  readonly index: number;
  readonly receiptSegment: NapCatAttachmentReceiptSegment;
  readonly transportSegment: NapCatAttachmentTransportSegment;
}

interface RemoteProbeUpdate extends RemoteProbeCandidate {
  readonly mediaType: string;
}

export interface PreparedNapCatRequest extends PushPreparedRequest<
  NapCatRequestReceipt,
  NapCatTransportRequest
> {
  readonly remoteMediaTypeProbeIndices: readonly number[];
}

export async function prepareNapCatRequest(
  target: NapCatTargetConfig,
  payload: NormalizedPushPayload,
  maxAttachmentBytes: number,
  signal?: AbortSignal
): Promise<PreparedNapCatRequest> {
  const attachmentContent = payload.content.filter(
    (item): item is PushAttachmentContent => item.type === 'attachment'
  );
  const attachments = await prepareNapCatAttachments(attachmentContent, maxAttachmentBytes, signal);
  const recipient =
    'user_id' in target
      ? ({ user_id: Number(target.user_id) } as const)
      : ({ group_id: Number(target.group_id) } as const);
  let nextAttachment = 0;
  const receiptMessage: NapCatReceiptMessageSegment[] = [];
  const transportMessage: NapCatTransportMessageSegment[] = [];
  const remoteMediaTypeProbeIndices: number[] = [];
  for (const item of payload.content) {
    if (item.type === 'text') {
      const segment = { type: 'text' as const, data: { text: item.text } };
      receiptMessage.push(segment);
      transportMessage.push(segment);
      continue;
    }
    const attachment = attachments[nextAttachment++]!;
    if (item.mediaType === undefined && attachment.receiptSegment.data.encoding === 'url') {
      remoteMediaTypeProbeIndices.push(transportMessage.length);
    }
    receiptMessage.push(attachment.receiptSegment);
    transportMessage.push(attachment.transportSegment);
  }

  const receiptRequest: NapCatRequestReceipt = {
    method: 'send_msg',
    params: {
      ...recipient,
      message: receiptMessage
    }
  };

  const transportRequest: NapCatTransportRequest = {
    method: 'send_msg',
    params: {
      ...recipient,
      message: transportMessage
    }
  };

  return {
    receiptRequest,
    transportRequest,
    remoteMediaTypeProbeIndices
  };
}

export async function updateNapCatRemoteMediaTypes(
  fetch: typeof globalThis.fetch,
  prepared: PreparedNapCatRequest,
  signal: AbortSignal
): Promise<void> {
  const candidates: RemoteProbeCandidate[] = [];
  for (const index of prepared.remoteMediaTypeProbeIndices) {
    const receiptSegment = prepared.receiptRequest.params.message[
      index
    ] as NapCatAttachmentReceiptSegment;
    const transportSegment = prepared.transportRequest.params.message[
      index
    ] as NapCatAttachmentTransportSegment;
    candidates.push({ index, receiptSegment, transportSegment });
  }

  const updates: RemoteProbeUpdate[] = [];
  let nextCandidate = 0;
  const probeWorker = async (): Promise<void> => {
    while (true) {
      signal.throwIfAborted();
      const candidateIndex = nextCandidate++;
      const candidate = candidates[candidateIndex];
      if (candidate === undefined) return;

      const mediaType = await probeRemoteMediaType(
        fetch,
        candidate.transportSegment.data.file,
        signal
      );
      if (mediaType !== undefined) {
        updates.push({ ...candidate, mediaType });
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(DEFAULT_REMOTE_PROBE_CONCURRENCY, candidates.length) },
      probeWorker
    )
  );

  for (const update of updates) {
    const { index, mediaType, receiptSegment, transportSegment } = update;
    const type = napCatAttachmentSegmentType(mediaType);
    prepared.receiptRequest.params.message[index] = {
      type,
      data: {
        ...receiptSegment.data,
        media_type: mediaType
      }
    };
    prepared.transportRequest.params.message[index] = {
      type,
      data: {
        file: transportSegment.data.file,
        ...(type === 'file' ? { name: receiptSegment.data.name } : {})
      }
    };
  }
}

async function probeRemoteMediaType(
  fetch: typeof globalThis.fetch,
  url: string,
  signal: AbortSignal
): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal
    });
    if (!response.ok) return undefined;
    const value = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    return value && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value) ? value : undefined;
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}
