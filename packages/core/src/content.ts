import { PushError } from './error.js';
import type { PushAttachmentContent, PushContent, PushTextContent } from './types.js';
import { isRecord } from './utils/value.js';

const MEDIA_TYPE_PATTERN = /^[!#$&^_.+0-9A-Za-z-]+\/[!#$&^_.+0-9A-Za-z-]+$/;
const TEXT_CONTENT_FIELDS = new Set(['type', 'text']);
const ATTACHMENT_CONTENT_FIELDS = new Set(['type', 'source', 'name', 'mediaType']);

export function normalizeContent(
  input: unknown,
  attachmentInput: unknown,
  hasAttachments: boolean
): readonly PushContent[] {
  const attachments = parseAttachmentInputs(attachmentInput, hasAttachments);
  let content: PushContent[];

  if (typeof input === 'string') {
    content = [...attachments, textContent(input)];
  } else if (Array.isArray(input)) {
    const stringInput = input.length === 0 || input.every((item) => typeof item === 'string');
    if (stringInput) {
      content = [...attachments, ...(input as readonly string[]).map(textContent)];
    } else {
      if (!input.every(isRecord) || hasAttachments) throw invalidContent();
      content = input.map(parseContent);
    }
  } else {
    throw invalidContent();
  }

  if (!hasMeaningfulContent(content)) throw invalidContent();
  return content;
}

function parseAttachmentInputs(input: unknown, present: boolean): readonly PushAttachmentContent[] {
  if (!present) return [];
  if (!Array.isArray(input)) throw invalidContent();
  if (input.some((source) => typeof source !== 'string' || source.trim().length === 0)) {
    throw invalidContent();
  }
  return input.map((source) => attachmentContent({ type: 'attachment', source }));
}

function parseContent(input: Readonly<Record<string, unknown>>): PushContent {
  if (input.type === 'text') {
    assertAllowedFields(input, TEXT_CONTENT_FIELDS);
    if (typeof input.text !== 'string') throw invalidContent();
    return textContent(input.text);
  }
  if (input.type === 'attachment') {
    assertAllowedFields(input, ATTACHMENT_CONTENT_FIELDS);
    return attachmentContent(input);
  }
  throw invalidContent();
}

function textContent(text: string): PushTextContent {
  return { type: 'text', text };
}

function attachmentContent(input: Readonly<Record<string, unknown>>): PushAttachmentContent {
  if (typeof input.source !== 'string' || input.source.trim().length === 0) {
    throw invalidContent();
  }
  if (
    input.name !== undefined &&
    (typeof input.name !== 'string' || input.name.trim().length === 0)
  ) {
    throw invalidContent();
  }
  if (
    input.mediaType !== undefined &&
    (typeof input.mediaType !== 'string' || !MEDIA_TYPE_PATTERN.test(input.mediaType))
  ) {
    throw invalidContent();
  }
  return {
    type: 'attachment',
    source: input.source,
    ...(input.name === undefined ? {} : { name: input.name as string }),
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType as string })
  };
}

function hasMeaningfulContent(content: readonly PushContent[]): boolean {
  return content.some((item) => item.type === 'attachment' || item.text.trim().length > 0);
}

function assertAllowedFields(
  input: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>
): void {
  if (Object.keys(input).some((key) => !allowed.has(key))) throw invalidContent();
}

function invalidContent(): PushError {
  return new PushError('INVALID_MESSAGE', 'Invalid push payload.');
}
