import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const srcAlias = decodeURIComponent(new URL('./src', import.meta.url).pathname).replace(
  /^\/([A-Za-z]:\/)/,
  '$1',
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': srcAlias,
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
