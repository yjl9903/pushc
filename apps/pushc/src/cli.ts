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
  description: packageJson.description
})
  .option('-c, --config <path>', 'Use a config directory or TOML file')
  .option('--json', 'Write a machine-readable JSON result');

cli
  .command('send [...content]', 'Send a message to a configured target')
  .option('-t, --target <destination>', 'Override the destination as adapter[:target]')
  .option('-f, --file <path>', 'Read a JSON, TOML or text message file')
  .option('-a, --attachment [...source]', 'Attach local files or HTTP(S) URLs')
  .option('-p, --param [...entry]', 'Set string payload parameters as key=value')
  .option('--title <title>', 'Set an optional message title')
  .option('--dry-run', 'Prepare the final request without sending')
  .action(async (content, options, ctx) => {
    let input: Awaited<ReturnType<typeof resolveMessageInput>>;

    try {
      const param = parseParamEntries(options.param);
      const attachments =
        options.attachment === undefined || options.attachment.length === 0
          ? undefined
          : options.attachment;
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

cli.command('targets', 'List configured targets').action(async (options, ctx) => {
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
