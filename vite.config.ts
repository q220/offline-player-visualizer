import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: process.env.BASE_URL || '/',
  root: 'src/client',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/static': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
