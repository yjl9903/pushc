#!/usr/bin/env node

import { breadc } from 'breadc';
import { formatDestination, PushError, type PushDryRunResult, type PushResult } from '@pushc/core';

import packageJson from '../package.json' with { type: 'json' };

import { makePushRuntime } from './client.js';
import { parseParamEntries, resolveMessage } from './input.js';
import { CliError, normalizeError } from './utils/error.js';
import {
  formatError,
  formatSendResult,
  formatTargets,
  getSendResultExitCode,
  type CliTargetSummary
} from './utils/format.js';

const cli = breadc('pushc', {
  version: packageJson.version,
  description: packageJson.description
})
  .option('-c, --config <path>', 'Use a config directory or TOML file')
  .option('--json', 'Write a machine-readable JSON result');

cli
  .command('send [...content]', 'Send a message to a configured target')
  .option('-t, --target <destination>', 'Select a destination as adapter[:target]')
  .option('-f, --file <path>', 'Read message content from a UTF-8 file')
  .option('--title <title>', 'Set an optional message title')
  .option('-p, --param [...entry]', 'Set string payload parameters as key=value')
  .option('--dry-run', 'Prepare the final request without sending')
  .action(async (content, options, ctx) => {
    let destination: string;
    let param: ReturnType<typeof parseParamEntries>;

    try {
      if (typeof options.target !== 'string') {
        throw new PushError('INVALID_TARGET', 'The --target option is required.');
      }
      destination = options.target;
      param = parseParamEntries(options.param);
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
      try {
        const message = await resolveMessage({
          content,
          ...(options.file ? { file: options.file } : {})
        });
        const payload = {
          message,
          ...(options.title === undefined ? {} : { title: options.title }),
          ...(param === undefined ? {} : { param })
        };
        result = options.dryRun
          ? await runtime.client.send(destination, payload, { dryRun: true })
          : await runtime.client.send(destination, payload);
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
