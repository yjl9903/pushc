#!/usr/bin/env node

import { breadc } from 'breadc';

import packageJson from '../package.json' with { type: 'json' };

import { makePushClient } from './client.js';
import { findConfigPath } from './config.js';
import { resolveMessage } from './input.js';
import { CliError } from './utils/error.js';
import {
  formatError,
  formatSuccess,
  formatTargets,
  type CliTargetSummary
} from './utils/format.js';
import { formatTargetAddress, parseTargetAddress } from './utils/target-address.js';

const cli = breadc('pushc', {
  version: packageJson.version,
  description: packageJson.description
})
  .option('-c, --config <path>', 'Use a config directory or TOML file')
  .option('--json', 'Write a machine-readable JSON result');

cli
  .command('send [...content]', 'Send a message to a configured target')
  .option('--target <address>', 'Select a target as adapter[:target]')
  .option('-f, --file <path>', 'Read message content from a UTF-8 file')
  .action(async (content, options, ctx) => {
    try {
      const destination = parseTargetAddress(options.target);
      const configPath = await findConfigPath({
        ...(options.config ? { config: options.config } : {})
      });
      const client = await makePushClient(configPath);
      const result = await (async () => {
        try {
          const message = await resolveMessage({
            content,
            ...(options.file ? { file: options.file } : {})
          });
          return await client.send({
            adapter: destination.adapter,
            ...(destination.target === undefined ? {} : { target: destination.target }),
            message: { content: message }
          });
        } finally {
          await client.destroy();
        }
      })();
      process.stdout.write(formatSuccess(result, options.json));
    } catch (error) {
      throw new CliError(error, ctx);
    }
  });

cli.command('targets', 'List configured targets').action(async (options, ctx) => {
  try {
    const configPath = await findConfigPath({
      ...(options.config ? { config: options.config } : {})
    });
    const client = await makePushClient(configPath);
    const targets = await (async () => {
      try {
        return [...client.adapters]
          .flatMap(([adapterName, adapter]): CliTargetSummary[] =>
            adapter.targets.size === 0
              ? [{ adapter: adapterName }]
              : [...adapter.targets].map(([targetName]) => ({
                  adapter: adapterName,
                  target: targetName
                }))
          )
          .sort((a, b) =>
            formatTargetAddress(a.adapter, a.target).localeCompare(
              formatTargetAddress(b.adapter, b.target)
            )
          );
      } finally {
        await client.destroy();
      }
    })();
    process.stdout.write(formatTargets(targets, options.json));
  } catch (error) {
    throw new CliError(error, ctx);
  }
});

try {
  await cli.run(process.argv.slice(2));
} catch (error) {
  const failure = formatError(error);
  process.stderr.write(failure.output);
  process.exitCode = failure.exitCode;
}
