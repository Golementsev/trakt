import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // общий пакет — исходники на TS, поэтому вшиваем его в сборку
  noExternal: ['@trakt/shared'],
});
