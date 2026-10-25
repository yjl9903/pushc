import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts'
  },
  format: ['esm'],
  dts: {
    tsconfig: '../../tsconfig.json'
  },
  clean: true,
  outDir: 'dist',
  platform: 'node'
});

export default config;
