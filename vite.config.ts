import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';

import { miaodaDevPlugin } from "miaoda-sc-plugin";

const MIAODA_CDN = 'https://miaoda-resource-static.s3cdn.medo.dev';

// Proxy miaoda CDN through Vite to avoid 500 from direct fetch; 500 -> 200 + empty script
function miaodaProxyPlugin() {
  return {
    name: 'miaoda-proxy',
    configureServer(server) {
      server.middlewares.use('/__miaoda_proxy', async (req, res) => {
        const urlPath = req.url?.replace(/^\//, '') || '';
        const target = `${MIAODA_CDN}/${urlPath}`;
        try {
          const r = await fetch(target);
          if (r.status >= 400) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/javascript');
            res.end('/* miaoda script unavailable */');
            return;
          }
          res.statusCode = r.status;
          r.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(await r.arrayBuffer());
        } catch (e) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/javascript');
          res.end('/* miaoda script load failed */');
        }
      });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(
          new RegExp(MIAODA_CDN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/([^"\'\\s]+)', 'g'),
          '/__miaoda_proxy/$1'
        );
      },
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Electron production loads via file://, so assets must be relative (not /assets/...)
  base: './',
  plugins: [
    react(),
    svgr({
      svgrOptions: { icon: true, exportType: 'named', namedExport: 'ReactComponent' },
    }),
    // This plugin injects dev tooling. Disable with VITE_DISABLE_MIAODA=1 if it causes 500 errors.
    ...(command === 'serve' && !process.env.VITE_DISABLE_MIAODA ? [miaodaDevPlugin(), miaodaProxyPlugin()] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },
}));
