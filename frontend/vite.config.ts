import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const srcAlias = decodeURIComponent(new URL('./src', import.meta.url).pathname).replace(
  /^\/([A-Za-z]:\/)/,
  '$1',
);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8000';

  return {
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
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
