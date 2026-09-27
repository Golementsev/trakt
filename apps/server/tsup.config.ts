import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'trakt-mcp': 'src/bin/trakt-mcp.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // общий пакет — исходники на TS, поэтому вшиваем его в сборку
  noExternal: ['@trakt/shared'],
});
