import { breadc } from 'breadc';

import packageJson from '../package.json' with { type: 'json' };

const { version, description } = packageJson;

const app = breadc('pushc', { version, description });

app.command('send <target>').action(async () => {});

await app.run(process.argv.slice(2));
