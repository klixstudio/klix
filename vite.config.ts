import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'web',
  plugins: [{
    // Dev server: serve /make like production does, without a trailing slash.
    name: 'clean-paths',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/make' || req.url?.startsWith('/make?')) req.url = req.url.replace('/make', '/make/');
        next();
      });
    },
  }],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landing: resolve('web/index.html'),
        make: resolve('web/make/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
    fs: { allow: ['..'] },
  },
});
