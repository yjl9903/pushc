import { resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { PushPayload } from '@pushc/core';

import { MessageInputError } from '../error.js';
import { isRecord } from '../utils/value.js';

export type MessageFormat = 'json' | 'toml' | 'text';

interface ParsedMessageSourceBase {
  readonly target?: string;
  readonly format: MessageFormat;
}

interface ParsedTextMessageSource extends ParsedMessageSourceBase {
  readonly format: 'text';
  readonly payload: { readonly content: string };
}

interface ParsedStructuredMessageSource extends ParsedMessageSourceBase {
  readonly format: 'json' | 'toml';
  readonly payload: PushPayload;
}

export type ParsedMessageSource = ParsedTextMessageSource | ParsedStructuredMessageSource;

export function parseMessageSource(
  source: string,
  extension: string | undefined,
  baseDirectory: string
): ParsedMessageSource {
  if (source.trim().length === 0) return textMessage(source);

  for (const format of parserOrder(extension)) {
    if (format === 'text') return textMessage(source);

    let parsed: unknown;
    try {
      parsed = format === 'json' ? JSON.parse(source) : parseToml(source);
    } catch {
      continue;
    }
    return structuredMessage(parsed, format, baseDirectory);
  }
  return textMessage(source);
}

export function textMessage(content: string): ParsedTextMessageSource {
  return { format: 'text', payload: { content } };
}

export function resolveAttachmentSource(source: string, baseDirectory: string): string {
  if (source.trim().length === 0) return source;
  if (/^[A-Za-z]:[\\/]/.test(source)) return source;
  if (/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(source)) return source;
  return resolve(baseDirectory, source);
}

function parserOrder(extension: string | undefined): readonly MessageFormat[] {
  switch (extension?.toLowerCase()) {
    case '.json':
      return ['json', 'toml', 'text'];
    case '.toml':
      return ['toml', 'json', 'text'];
    case '.txt':
      return ['text'];
    default:
      return ['json', 'toml', 'text'];
  }
}

function structuredMessage(
  input: unknown,
  format: 'json' | 'toml',
  baseDirectory: string
): ParsedStructuredMessageSource {
  if (!isRecord(input)) {
    throw new MessageInputError(
      'MESSAGE_INVALID',
      `The ${format.toUpperCase()} message must be an object.`
    );
  }

  const { target, ...payloadInput } = input;
  if (target !== undefined && typeof target !== 'string') {
    throw new MessageInputError('MESSAGE_INVALID', 'Message target must be a string.');
  }

  return {
    ...(target === undefined ? {} : { target }),
    format,
    payload: mapStructuredPayload(payloadInput, baseDirectory)
  };
}

function mapStructuredPayload(
  input: Readonly<Record<string, unknown>>,
  baseDirectory: string
): PushPayload {
  const output = { ...input } as Record<string, unknown>;

  if (Array.isArray(input.attachments)) {
    output.attachments = input.attachments.map((source) =>
      typeof source === 'string' ? resolveAttachmentSource(source, baseDirectory) : source
    );
  }
  if (Array.isArray(input.content)) {
    output.content = input.content.map((item) =>
      isRecord(item) && item.type === 'attachment'
        ? mapAttachmentContent(item, baseDirectory)
        : item
    );
  }

  return output as unknown as PushPayload;
}

function mapAttachmentContent(
  input: Readonly<Record<string, unknown>>,
  baseDirectory: string
): Readonly<Record<string, unknown>> {
  if (input.media_type !== undefined && input.mediaType !== undefined) {
    throw new MessageInputError(
      'MESSAGE_INVALID',
      'Attachment content cannot define both media_type and mediaType.'
    );
  }

  const { media_type: mediaType, ...content } = input;
  return {
    ...content,
    ...(typeof content.source === 'string'
      ? { source: resolveAttachmentSource(content.source, baseDirectory) }
      : {}),
    ...(mediaType === undefined ? {} : { mediaType })
  };
}
