#!/usr/bin/env node

import { breadc } from 'breadc';

import { formatDestination, PushError, type PushDryRunResult, type PushResult } from '@pushc/core';

import packageJson from '../package.json' with { type: 'json' };

import { makePushRuntime } from './client.js';
import { CliError, formatError, getSendResultExitCode, normalizeError } from './error.js';
import { parseParamEntries, resolveMessageInput } from './input/index.js';
import { formatSendResult, formatTargets, type CliTargetSummary } from './utils/format.js';

const cli = breadc('pushc', {
  version: packageJson.version,
  description: {
    text: 'Send messages and attachments to configured destinations.',
    examples: [
      { command: 'pushc targets', comment: 'List destinations' },
      { command: 'pushc send "Build completed" --target qq:ops', comment: 'Send a message' },
      { command: 'pushc send --help', comment: 'See message formats and more examples' }
    ]
  }
})
  .option(
    '-c, --config <path>',
    'Config directory or TOML file. Defaults, in order:\n' +
      'PUSHC_CONFIG, .pushc/config.toml,\n' +
      '$XDG_CONFIG_HOME/pushc/config.toml,\n' +
      '~/.config/pushc/config.toml.'
  )
  .option('--json', 'Write a machine-readable JSON result');

cli
  .command('send', {
    summary: 'Send a message to a configured target',
    text: 'Accepts text, JSON and TOML from a file or stdin.',
    examples: [
      { command: 'pushc send "Build completed" --target qq:ops', comment: 'Send text' },
      { command: 'git log -1 | pushc send --target qq:ops', comment: 'Pipe a message' },
      { command: 'pushc send --target qq:ops --file ./report.txt', comment: 'Send a text file' },
      {
        command: 'pushc send --file ./message.json',
        comment: 'Read a message file: {"target":"qq:ops","content":"Build completed"}'
      },
      {
        command:
          'pushc send "{{title}} completed for {{param.environment}}" --target qq:ops \\\n  --title "Build" --param environment=production',
        comment: 'Set a title and template parameters'
      },
      {
        command:
          'pushc send "Build completed" --target qq:ops \\\n  --attachment ./chart.png ./report.pdf',
        comment: 'Attach files'
      },
      {
        command: 'pushc send "Build completed" --target qq:ops --dry-run --json',
        comment: 'Preview the request as JSON'
      }
    ]
  })
  .argument('[...content]', 'Message text; reads stdin when no text or --file is given')
  .option(
    '-t, --target <destination>',
    'Use adapter[:target] from pushc targets.\n' +
      'Overrides the message target; required if absent.'
  )
  .option(
    '-f, --file <path>',
    'Read a JSON, TOML or text message file.\n' +
      'Replaces stdin; cannot be used with message text.\n' +
      '.txt files are always plain text.'
  )
  .option(
    '-a, --attachment <...source>',
    'Attach files or HTTP(S) URLs where supported.\n' +
      'Multiple sources; repeatable. Put text first.\n' +
      'For JSON/TOML, put attachments in the message.'
  )
  .option(
    '-p, --param <...entry>',
    'Set key=value template parameters.\n' +
      'Overrides matching message parameters.\n' +
      'Multiple entries; repeatable. Put text first.'
  )
  .option('--title <title>', 'Set a title, overriding the message title')
  .option('--dry-run', 'Prepare the final request without sending')
  .action(async (content, options, ctx) => {
    let input: Awaited<ReturnType<typeof resolveMessageInput>>;

    try {
      const param = parseParamEntries(options.param);
      const attachments = options.attachment.length === 0 ? undefined : options.attachment;
      input = await resolveMessageInput({
        content,
        ...(options.file ? { file: options.file } : {}),
        ...(typeof options.target === 'string' ? { target: options.target } : {}),
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(param === undefined ? {} : { param }),
        ...(attachments === undefined ? {} : { attachments })
      });
      if (input.target === undefined) {
        throw new PushError('INVALID_TARGET', 'The --target option is required.');
      }
    } catch (error) {
      throw new CliError(error, ctx);
    }

    const runtime = await makePushRuntime({
      ...(options.config ? { config: options.config } : {})
    });
    if (!runtime.success) {
      throw new CliError(runtime.error, ctx, runtime.redactions);
    }

    try {
      let result: PushResult | PushDryRunResult;
      const sendOptions = input.basePath === undefined ? {} : { basePath: input.basePath };
      try {
        result = options.dryRun
          ? await runtime.client.send(input.target, input.payload, {
              ...sendOptions,
              dryRun: true
            })
          : await runtime.client.send(input.target, input.payload, sendOptions);
      } catch (error) {
        await runtime.client.destroy().catch(() => undefined);
        throw error;
      }

      try {
        await runtime.client.destroy();
      } catch (error) {
        if (result.success) {
          const failure = {
            success: false as const,
            adapter: result.adapter,
            ...(result.target === undefined ? {} : { target: result.target }),
            receipt: result.receipt,
            error: normalizeError(error)
          };

          if (options.dryRun) {
            result = { dryRun: true, ...failure };
          } else {
            result = failure;
          }
        }
      }

      const output = formatSendResult(result, options.json, runtime.redactions);
      process.exitCode = getSendResultExitCode(result);
      if (result.success) {
        process.stdout.write(output);
      } else {
        process.stderr.write(output);
      }
    } catch (error) {
      throw new CliError(error, ctx, runtime.redactions);
    }
  });

cli
  .command('targets', {
    summary: 'List configured targets',
    text:
      'List destinations from your config as adapter or adapter:target.\n' +
      'Use a listed destination with pushc send --target. No messages are sent.',
    examples: [
      { command: 'pushc targets', comment: 'List available destinations' },
      { command: 'pushc targets --config ./team/config.toml', comment: 'Use another config' },
      { command: 'pushc targets --json', comment: 'Get destinations as JSON' }
    ]
  })
  .action(async (options, ctx) => {
    const runtime = await makePushRuntime({
      ...(options.config ? { config: options.config } : {})
    });
    if (!runtime.success) {
      throw new CliError(runtime.error, ctx, runtime.redactions);
    }

    try {
      const targets = await (async () => {
        try {
          return [...runtime.client.adapters]
            .flatMap(([adapterName, adapter]): CliTargetSummary[] =>
              adapter.targets.size === 0
                ? [{ adapter: adapterName }]
                : [...adapter.targets].map(([targetName]) => ({
                    adapter: adapterName,
                    target: targetName
                  }))
            )
            .sort((a, b) =>
              formatDestination(a.adapter, a.target).localeCompare(
                formatDestination(b.adapter, b.target)
              )
            );
        } finally {
          await runtime.client.destroy();
        }
      })();
      process.stdout.write(formatTargets(targets, options.json));
    } catch (error) {
      throw new CliError(error, ctx, runtime.redactions);
    }
  });

try {
  await cli.run(process.argv.slice(2));
} catch (error) {
  const failure = formatError(error);
  process.stderr.write(failure.output);
  process.exitCode = failure.exitCode;
}
