import { PushError } from './error.js';
import { renderTemplate, type TemplateContext } from './template.js';
import type { PushAttachmentContent, PushContent, PushTextContent } from './types.js';
import { isRecord } from './utils/value.js';

const MEDIA_TYPE_PATTERN = /^[!#$&^_.+0-9A-Za-z-]+\/[!#$&^_.+0-9A-Za-z-]+$/;
const TEXT_CONTENT_FIELDS = new Set(['type', 'text']);
const ATTACHMENT_CONTENT_FIELDS = new Set(['type', 'source', 'name', 'mediaType']);

export function normalizeContent(
  input: unknown,
  attachmentInput: unknown,
  hasAttachments: boolean,
  templateContext: TemplateContext
): readonly PushContent[] {
  const attachments = parseAttachmentInputs(attachmentInput, hasAttachments, templateContext);
  let content: PushContent[];

  if (typeof input === 'string') {
    content = [...attachments, textContent(input, templateContext)];
  } else if (Array.isArray(input)) {
    const stringInput = input.length === 0 || input.every((item) => typeof item === 'string');
    if (stringInput) {
      content = [
        ...attachments,
        ...(input as readonly string[]).map((text) => textContent(text, templateContext))
      ];
    } else {
      if (!input.every(isRecord) || hasAttachments) throw invalidContent();
      content = input.map((item) => parseContent(item, templateContext));
    }
  } else {
    throw invalidContent();
  }

  if (!hasMeaningfulContent(content)) throw invalidContent();
  return content;
}

function parseAttachmentInputs(
  input: unknown,
  present: boolean,
  templateContext: TemplateContext
): readonly PushAttachmentContent[] {
  if (!present) return [];
  if (!Array.isArray(input)) throw invalidContent();
  if (input.some((source) => typeof source !== 'string')) throw invalidContent();
  return input.map((source) => attachmentContent({ type: 'attachment', source }, templateContext));
}

function parseContent(
  input: Readonly<Record<string, unknown>>,
  templateContext: TemplateContext
): PushContent {
  if (input.type === 'text') {
    assertAllowedFields(input, TEXT_CONTENT_FIELDS);
    if (typeof input.text !== 'string') throw invalidContent();
    return textContent(input.text, templateContext);
  }
  if (input.type === 'attachment') {
    assertAllowedFields(input, ATTACHMENT_CONTENT_FIELDS);
    return attachmentContent(input, templateContext);
  }
  throw invalidContent();
}

function textContent(text: string, templateContext: TemplateContext): PushTextContent {
  return { type: 'text', text: renderTemplate(text, templateContext) };
}

function attachmentContent(
  input: Readonly<Record<string, unknown>>,
  templateContext: TemplateContext
): PushAttachmentContent {
  if (typeof input.source !== 'string') throw invalidContent();
  if (input.name !== undefined && typeof input.name !== 'string') throw invalidContent();
  if (input.mediaType !== undefined && typeof input.mediaType !== 'string') throw invalidContent();

  const source = renderTemplate(input.source, templateContext);
  const name = input.name === undefined ? undefined : renderTemplate(input.name, templateContext);
  const mediaType =
    input.mediaType === undefined ? undefined : renderTemplate(input.mediaType, templateContext);
  if (source.trim().length === 0) throw invalidContent();
  if (name !== undefined && name.trim().length === 0) throw invalidContent();
  if (mediaType !== undefined && !MEDIA_TYPE_PATTERN.test(mediaType)) throw invalidContent();

  return {
    type: 'attachment',
    source,
    ...(name === undefined ? {} : { name }),
    ...(mediaType === undefined ? {} : { mediaType })
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
