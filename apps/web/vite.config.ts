import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Адрес сервера (DEFAULT_HOST/DEFAULT_PORT из @trakt/shared). Конфиг Vite грузится
// самим Node, который не читает TS-исходники shared, поэтому значения продублированы.
const server = `http://127.0.0.1:${process.env.TRAKT_PORT || 4700}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': server,
      '/mcp': server,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
