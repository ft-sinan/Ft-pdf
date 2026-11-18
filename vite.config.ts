import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
const resolve = createRequire(import.meta.url).resolve;
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^stream$/, replacement: resolve('readable-stream/readable-browser.js') },
      ...['buffer', 'events', 'util'].map((p) => ({
        find: new RegExp(`^${p}$`),
        replacement: resolve(p + '/'),
      })),
      ...(mode === 'android'
        ? [
            { find: /^pdfjs-dist$/, replacement: resolve('pdfjs-dist/legacy/build/pdf.mjs') },
            {
              find: 'pdfjs-dist/build/pdf.worker.min.mjs',
              replacement: resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
            },
          ]
        : []),
    ],
  },
  worker: { format: 'es' },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/data/**',
        '**/*.sqlite*',
        '**/server/**',
        '**/tests/**',
        '**/android/**',
      ],
    },
  },
  build: { chunkSizeWarningLimit: 900, ...(mode === 'android' ? { target: 'chrome105' } : {}) },
}));
