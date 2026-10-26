import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const frontendRoot = resolve(projectRoot, 'frontend');

export default defineConfig({
  plugins: [react()],
  root: frontendRoot,
  publicDir: false,
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // All APIs now use Laravel sessions; never mix this with the native PHP server.
      '/api': 'http://127.0.0.1:8001',
      // The favicon is served from the PHP document root, which Vite must not copy into dist.
      '/favicon.svg': 'http://127.0.0.1:8001',
    },
  },
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        login: resolve(frontendRoot, 'index.html'),
        register: resolve(frontendRoot, 'pages/register.html'),
        recovery: resolve(frontendRoot, 'pages/forgot-password.html'),
        registrationSuccess: resolve(frontendRoot, 'pages/registration-success.html'),
        workspace: resolve(frontendRoot, 'pages/workspace.html'),
      },
    },
  },
});
