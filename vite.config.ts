import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';

import { miaodaDevPlugin } from "miaoda-sc-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), svgr({
      svgrOptions: {
        icon: true, exportType: 'named', namedExport: 'ReactComponent', }, }), miaodaDevPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false, // Disable sourcemaps for production (enable only if needed for debugging)
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: (id) => {
          // React and React DOM
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor';
          }
          
          // Radix UI / ShadCN components
          if (id.includes('node_modules/@radix-ui/')) {
            return 'radix-vendor';
          }
          
          // Chart libraries
          if (id.includes('node_modules/recharts/')) {
            return 'charts-vendor';
          }
          
          // Export libraries (will be lazy loaded, but chunk them separately if they end up in bundle)
          if (id.includes('node_modules/xlsx/')) {
            return 'xlsx-vendor';
          }
          if (id.includes('node_modules/jspdf/') || id.includes('node_modules/jspdf-autotable/')) {
            return 'pdf-vendor';
          }
          
          // React Query
          if (id.includes('node_modules/@tanstack/react-query/')) {
            return 'query-vendor';
          }
          
          // Router
          if (id.includes('node_modules/react-router/')) {
            return 'router-vendor';
          }
          
          // i18n
          if (id.includes('node_modules/i18next/') || id.includes('node_modules/react-i18next/')) {
            return 'i18n-vendor';
          }
          
          // Other large dependencies
          if (id.includes('node_modules/')) {
            return 'vendor';
          }
        },
      },
    },
  },
});
