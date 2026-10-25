import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  entry: {
    index: 'src/index.ts'
  },
  format: ['esm'],
  dts: {
    tsconfig: '../../tsconfig.json'
  },
  clean: true,
  outDir: 'dist',
  platform: 'neutral'
});

export default config;
