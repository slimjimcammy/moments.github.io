import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
  // @moments/shared ships TypeScript source, so let Vite transform it instead
  // of trying to pre-bundle it as a dependency.
  optimizeDeps: { exclude: ['@moments/shared'] },
});
