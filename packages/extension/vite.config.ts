import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build 1 of 2: the ES-module parts of the extension.
 *
 *   dist/background.js  — MV3 service worker (type: "module")
 *   dist/popup.html/js  — the browser-action popup
 *   dist/manifest.json  — copied from public/
 *
 * The content script can't be an ES module, so it gets its own build; see
 * vite.config.content.ts. Both write into dist/ without emptying it, and
 * `npm run build` removes dist/ up front.
 */
export default defineConfig({
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    // The service worker is cold-started by the hotkey, so parse time is felt.
    // Minify, but ship source maps so DevTools still shows real code.
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'src/background.ts'),
        popup: resolve(import.meta.dirname, 'popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  optimizeDeps: {
    exclude: ['@moments/shared'],
  },
});
