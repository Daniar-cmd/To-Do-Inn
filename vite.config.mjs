import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(projectRoot, 'public');

export default defineConfig({
  plugins: [react()],
  root: publicRoot,
  publicDir: false,
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // All APIs now use Laravel sessions; never mix this with the native PHP server.
      '/api': 'http://127.0.0.1:8001',
    },
  },
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        login: resolve(publicRoot, 'index.html'),
        register: resolve(publicRoot, 'pages/register.html'),
        recovery: resolve(publicRoot, 'pages/forgot-password.html'),
        registrationSuccess: resolve(publicRoot, 'pages/registration-success.html'),
        workspace: resolve(publicRoot, 'pages/workspace.html'),
      },
    },
  },
});
