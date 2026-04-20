import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5180,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:3334', changeOrigin: true },
    },
  },
});
