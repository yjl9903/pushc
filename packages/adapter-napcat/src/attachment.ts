import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { basename, posix, resolve } from 'node:path';

import mime from 'mime';

import { PushError, type PushAttachmentContent } from '@pushc/core';

import type {
  NapCatAttachmentReceiptSegment,
  NapCatAttachmentSegmentType,
  NapCatAttachmentTransportSegment
} from './types.js';

export interface PreparedNapCatAttachment {
  readonly receiptSegment: NapCatAttachmentReceiptSegment;
  readonly transportSegment: NapCatAttachmentTransportSegment;
}

export async function prepareNapCatAttachments(
  attachments: readonly PushAttachmentContent[],
  maxBytes: number,
  signal?: AbortSignal
): Promise<readonly PreparedNapCatAttachment[]> {
  const prepared: PreparedNapCatAttachment[] = [];
  let actualLocalBytes = 0;
  const baseDirectory = process.cwd();

  for (const attachment of attachments) {
    assertNotAborted(signal);
    const remote = parseRemoteAttachment(attachment.source);
    if (remote !== undefined) {
      prepared.push(prepareRemoteAttachment(remote, attachment));
      continue;
    }

    const path = resolve(baseDirectory, attachment.source);
    const name =
      attachment.name === undefined ? basename(path) : validateAttachmentName(attachment.name);
    const contents = await readLocalAttachment(
      path,
      name,
      maxBytes - actualLocalBytes,
      maxBytes,
      signal
    );
    actualLocalBytes += contents.byteLength;

    const mediaType = attachment.mediaType ?? mediaTypeFor(name);
    const type = napCatAttachmentSegmentType(mediaType);
    const fileValue = `base64://${contents.toString('base64')}`;
    prepared.push({
      receiptSegment: {
        type,
        data: {
          name,
          media_type: mediaType,
          size: contents.byteLength,
          sha256: createHash('sha256').update(contents).digest('hex'),
          encoding: 'base64'
        }
      },
      transportSegment: {
        type,
        data: {
          file: fileValue,
          ...(type === 'file' ? { name } : {})
        }
      }
    });
  }

  return prepared;
}

function parseRemoteAttachment(input: string): URL | undefined {
  if (/^[A-Za-z]:[\\/]/.test(input)) return undefined;

  const scheme = /^([A-Za-z][A-Za-z\d+.-]*):/.exec(input);
  if (scheme === null || !input.slice(scheme[0].length).startsWith('//')) return undefined;
  if (scheme[1]!.toLowerCase() !== 'http' && scheme[1]!.toLowerCase() !== 'https') {
    throw invalidAttachment('Remote attachment URLs must use HTTP or HTTPS.');
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalidAttachment('Remote attachment URL is invalid.');
  }

  if (url.username !== '' || url.password !== '') {
    throw invalidAttachment('Remote attachment URLs must not contain credentials.');
  }
  return url;
}

function prepareRemoteAttachment(
  url: URL,
  attachment: PushAttachmentContent
): PreparedNapCatAttachment {
  const name =
    attachment.name === undefined ? remoteName(url) : validateAttachmentName(attachment.name);
  const mediaType = attachment.mediaType ?? mediaTypeFor(name);
  const type = napCatAttachmentSegmentType(mediaType);

  return {
    receiptSegment: {
      type,
      data: {
        name,
        media_type: mediaType,
        host: url.host,
        encoding: 'url'
      }
    },
    transportSegment: {
      type,
      data: {
        file: url.toString(),
        ...(type === 'file' ? { name } : {})
      }
    }
  };
}

function remoteName(url: URL): string {
  const encodedName = posix.basename(url.pathname);
  if (encodedName === '') return 'remote-file';

  let decodedName = encodedName;
  try {
    decodedName = decodeURIComponent(encodedName);
  } catch {
    // URL permits literal percent characters that are not URI escape sequences.
  }
  const name = decodedName.split(/[\\/]/).at(-1)!;
  if (name === '' || name === '.' || name === '..') return 'remote-file';
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw invalidAttachment('Remote attachment filenames must not contain control characters.');
  }
  return name;
}

function validateAttachmentName(name: string): string {
  if (name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)) {
    throw invalidAttachment('Attachment names must be safe filenames.');
  }
  return name;
}

function mediaTypeFor(name: string): string {
  return mime.getType(name) ?? 'application/octet-stream';
}

export function napCatAttachmentSegmentType(mediaType: string): NapCatAttachmentSegmentType {
  const normalizedMediaType = mediaType.toLowerCase();
  if (normalizedMediaType.startsWith('image/')) return 'image';
  if (normalizedMediaType.startsWith('audio/')) return 'record';
  if (normalizedMediaType.startsWith('video/')) return 'video';
  return 'file';
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw aborted(signal);
}

function aborted(signal: AbortSignal): PushError {
  return new PushError('SEND_FAILED', 'Message sending was aborted.', {
    cause: signal.reason
  });
}

function attachmentLimitExceeded(maxBytes: number): PushError {
  return new PushError(
    'INVALID_MESSAGE',
    `Attachments exceed the configured limit of ${maxBytes} bytes.`
  );
}

function invalidAttachment(message: string, cause?: unknown): PushError {
  return new PushError('INVALID_MESSAGE', message, { cause });
}

async function readLocalAttachment(
  path: string,
  name: string,
  remainingBytes: number,
  maxBytes: number,
  signal?: AbortSignal
): Promise<Buffer> {
  assertNotAborted(signal);

  let file: FileHandle;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if (signal?.aborted) throw aborted(signal);
    throw invalidAttachment(`Could not access attachment "${name}".`, error);
  }

  try {
    assertNotAborted(signal);
    const info = await file.stat();
    assertNotAborted(signal);
    if (!info.isFile()) {
      throw invalidAttachment(`Attachment "${name}" must be a regular file.`);
    }
    if (info.size > remainingBytes) throw attachmentLimitExceeded(maxBytes);

    return await readBoundedFile(file, info.size, name, signal);
  } catch (error) {
    if (error instanceof PushError) throw error;
    if (signal?.aborted) throw aborted(signal);
    throw invalidAttachment(`Could not read attachment "${name}".`, error);
  } finally {
    await file.close().catch(() => undefined);
  }
}

async function readBoundedFile(
  file: FileHandle,
  expectedBytes: number,
  name: string,
  signal?: AbortSignal
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let actualBytes = 0;
  const stream = file.createReadStream({
    autoClose: false,
    start: 0,
    end: expectedBytes,
    signal
  });

  for await (const contents of stream) {
    actualBytes += contents.byteLength;
    if (actualBytes > expectedBytes) {
      throw invalidAttachment(`Attachment "${name}" changed while it was being read.`);
    }
    chunks.push(contents);
  }

  return Buffer.concat(chunks, actualBytes);
}
