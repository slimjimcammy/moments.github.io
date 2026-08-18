import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Build 2 of 2: the content script.
 *
 * Chrome runs content scripts as classic scripts, so this has to be a single
 * self-contained IIFE with no code splitting and no imports at runtime.
 * publicDir is off so it doesn't re-copy (or fight over) build 1's output.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    // Injected into every YouTube page, so keep it small.
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/content/index.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        inlineDynamicImports: true,
        extend: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@moments/shared'],
  },
});
