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
        ? [{ find: /^pdfjs-dist$/, replacement: resolve('pdfjs-dist/legacy/build/pdf.mjs') }]
        : []),
    ],
  },
  // Avoid a dev-server dependency reload halfway through the first file-handle launch.
  optimizeDeps: {
    include: [
      'mammoth/mammoth.browser.min.js',
      'word-extractor/lib/buffer-reader.js',
      'word-extractor/lib/word-ole-extractor.js',
      'buffer',
      'process/browser',
      'fflate',
      'docx',
    ],
  },
  worker: { format: 'es' },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    watch: { ignored: ['**/android/**/build/**', '**/test-results/**'] },
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
