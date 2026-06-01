import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5180,
    strictPort: true,
    host: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/r': 'http://localhost:8787',
    },
  },
});
