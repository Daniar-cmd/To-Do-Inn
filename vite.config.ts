import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const frontendRoot = resolve(projectRoot, 'frontend');

export default defineConfig(({ command, isPreview }) => {
  const developmentServer = command === 'serve' && !isPreview;
  return {
    plugins: [
      react(),
      ...(developmentServer ? [{
        name: 'todo-inn-local-server',
        async configureServer(server: ViteDevServer) {
          const favicon = await readFile(resolve(projectRoot, 'public/favicon.svg'));
          server.middlewares.use((request, response, next) => {
            const remote = request.socket.remoteAddress;
            if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
              response.statusCode = 403;
              response.end();
              return;
            }
            if (request.url?.split('?')[0] === '/favicon.svg' && (request.method === 'GET' || request.method === 'HEAD')) {
              response.setHeader('Content-Type', 'image/svg+xml');
              response.end(request.method === 'HEAD' ? undefined : favicon);
              return;
            }
            next();
          });
        },
      }] : []),
    ],
    root: frontendRoot,
    publicDir: false,
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': 'http://127.0.0.1:8002',
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
          corporateInvitation: resolve(frontendRoot, 'pages/corporate-invitation.html'),
          organizationRoot: resolve(frontendRoot, 'pages/organization-root.html'),
          workspace: resolve(frontendRoot, 'pages/workspace.html'),
        },
      },
    },
  };
});
