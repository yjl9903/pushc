import { readFile } from 'node:fs/promises';

export interface ResolveMessageOptions {
  content?: readonly string[];
  file?: string;
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
}

export type MessageInputErrorCode =
  'MESSAGE_SOURCE_CONFLICT' | 'MESSAGE_FILE_FAILED' | 'MESSAGE_EMPTY';

export class MessageInputError extends Error {
  readonly code: MessageInputErrorCode;
  override readonly cause?: unknown;

  constructor(code: MessageInputErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = 'MessageInputError';
    this.code = code;
    this.cause = options.cause;
  }
}

export class CliUsageError extends Error {
  readonly code = 'CLI_USAGE';

  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

const PARAM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function parseParamEntries(
  entries: readonly string[] | undefined
): Readonly<Record<string, string>> | undefined {
  if (!entries || entries.length === 0) return undefined;
  const params = Object.create(null) as Record<string, string>;
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    const key = separator < 0 ? '' : entry.slice(0, separator);
    if (separator < 0 || !PARAM_KEY_PATTERN.test(key)) {
      throw new CliUsageError(
        '--param entries must use key=value with keys containing only letters, digits, _, . or -.'
      );
    }
    if (Object.hasOwn(params, key)) {
      throw new CliUsageError(`Duplicate --param key "${key}".`);
    }
    params[key] = entry.slice(separator + 1);
  }
  return params;
}

export async function resolveMessage(options: ResolveMessageOptions = {}): Promise<string> {
  const content = options.content ?? [];
  if (content.length > 0 && options.file) {
    throw new MessageInputError(
      'MESSAGE_SOURCE_CONFLICT',
      'Message content and --file cannot be used together.'
    );
  }

  let message: string;
  if (content.length > 0) {
    message = content.join(' ');
  } else if (options.file) {
    try {
      message = await readFile(options.file, 'utf8');
    } catch (error) {
      throw new MessageInputError(
        'MESSAGE_FILE_FAILED',
        `Could not read message file ${options.file}.`,
        {
          cause: error
        }
      );
    }
  } else {
    const stdin = options.stdin ?? process.stdin;
    if (stdin.isTTY) {
      throw new MessageInputError(
        'MESSAGE_EMPTY',
        'Provide message content, --file, or pipe content through stdin.'
      );
    }
    message = await readStream(stdin);
  }

  if (message.trim().length === 0) {
    throw new MessageInputError('MESSAGE_EMPTY', 'Message content must not be empty.');
  }
  return message;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}
