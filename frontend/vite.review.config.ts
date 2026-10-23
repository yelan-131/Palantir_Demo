import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const root = decodeURIComponent(new URL('.', import.meta.url).pathname);
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': `${root}src` } },
  server: { host: '127.0.0.1', port: 13003, strictPort: true },
  build: { outDir: 'dist-ui-review', rollupOptions: { input: `${root}ui-review.html` } },
});
