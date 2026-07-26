import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

import type { PushPayload } from '@pushc/core';

import { CliUsageError, MessageInputError } from '../error.js';
import {
  parseMessageSource,
  resolveAttachmentSource,
  textMessage,
  type ParsedMessageSource
} from './message.js';
import { applyParamOverrides } from './params.js';

export { parseParamEntries } from './params.js';

export interface ResolveMessageInputOptions {
  content?: readonly string[];
  file?: string;
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  target?: string;
  title?: string;
  param?: Readonly<Record<string, string>>;
  attachments?: readonly string[];
  cwd?: string;
}

export interface ParsedMessageInput {
  readonly target?: string;
  readonly payload: PushPayload;
}

export async function resolveMessageInput(
  options: ResolveMessageInputOptions = {}
): Promise<ParsedMessageInput> {
  const content = options.content ?? [];
  if (content.length > 0 && options.file) {
    throw new MessageInputError(
      'MESSAGE_SOURCE_CONFLICT',
      'Message content and --file cannot be used together.'
    );
  }

  const cwd = options.cwd ?? process.cwd();
  const attachments = options.attachments ?? [];
  const parsed = await readMessageSource(content, options.file, options.stdin, attachments, cwd);

  if (parsed.format !== 'text') {
    assertNoStructuredMessageAttachments(options);
    const payload = applyParamOverrides(parsed.payload, options.param);
    return {
      payload: options.title === undefined ? payload : { ...payload, title: options.title },
      ...(parsed.target === undefined ? {} : { target: parsed.target }),
      ...(options.target === undefined ? {} : { target: options.target })
    };
  }

  const resolvedAttachments =
    attachments.length === 0
      ? undefined
      : attachments.map((source) => resolveAttachmentSource(source, cwd));
  if (parsed.payload.content.trim().length === 0 && resolvedAttachments === undefined) {
    throw new MessageInputError('MESSAGE_EMPTY', 'Message content must not be empty.');
  }

  return {
    target: options.target,
    payload: {
      content: parsed.payload.content,
      ...(resolvedAttachments === undefined ? {} : { attachments: resolvedAttachments }),
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options.param === undefined ? {} : { param: options.param })
    }
  };
}

async function readMessageSource(
  content: readonly string[],
  file: string | undefined,
  stdin: (NodeJS.ReadableStream & { isTTY?: boolean }) | undefined,
  attachments: readonly string[],
  cwd: string
): Promise<ParsedMessageSource> {
  if (content.length > 0) return textMessage(content.join(' '));
  if (file) return await readMessageFile(file, cwd);

  const input = stdin ?? process.stdin;
  if (input.isTTY) {
    if (attachments.length === 0) {
      throw new MessageInputError(
        'MESSAGE_EMPTY',
        'Provide message content, --file, or pipe content through stdin.'
      );
    }
    return textMessage('');
  }
  return parseMessageSource(await readStream(input), undefined, cwd);
}

async function readMessageFile(file: string, cwd: string): Promise<ParsedMessageSource> {
  const path = resolve(cwd, file);
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new MessageInputError('MESSAGE_FILE_FAILED', `Could not read message file ${path}.`, {
      cause: error
    });
  }
  return parseMessageSource(source, extname(path), dirname(path));
}

function assertNoStructuredMessageAttachments(options: ResolveMessageInputOptions): void {
  if (options.attachments !== undefined) {
    throw new CliUsageError('--attachment cannot be combined with a structured message.');
  }
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}
