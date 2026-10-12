import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['cli/index.ts'],
  format: ['esm'],
  clean: true,
  dts: false,
  sourcemap: false,
  platform: 'node',
  target: 'node22',
  external: ['typescript'],
});
