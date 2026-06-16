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
    port: Number(process.env.VITE_DEV_PORT || 5173),
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        kassa: path.resolve(__dirname, 'kassa.html'),
      },
      output: {
        // Split heavy, stable third-party libs into separate cacheable chunks
        // so the main app bundle is smaller and vendor code stays cached across
        // app updates. Function form is safe: unmatched ids fall through to
        // Vite's default chunking.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory')) return 'charts';
          if (id.includes('xlsx') || id.includes('exceljs')) return 'xlsx';
          if (id.includes('jspdf')) return 'pdf';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/')
          ) {
            return 'react-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
  // Drop noisy console.log/debug/info from production bundles (keeps
  // console.error/warn). Dev builds are unaffected.
  esbuild: {
    pure: command === 'build' ? ['console.log', 'console.debug', 'console.info'] : [],
  },
}));
