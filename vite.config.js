import { defineConfig, loadEnv } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
  // Load env variables
  const env = loadEnv(mode, process.cwd(), '');
  const targetUrl = env.APPS_SCRIPT_URL || '';

  return {
    plugins: [viteSingleFile()],
    build: {
      assetsInlineLimit: 100000000,
      chunkSizeWarningLimit: 100000000,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
    server: {
      proxy: {
        '/api/data': {
          target: targetUrl 
            ? targetUrl + (targetUrl.includes('?') ? '&' : '?') + 'action=getData' 
            : 'http://localhost',
          changeOrigin: true,
          followRedirects: true,
          rewrite: () => '',
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              if (req.method === 'POST') {
                try {
                  if (!proxyReq.headersSent && typeof proxyReq.getHeader === 'function' && !proxyReq.getHeader('Content-Type')) {
                    proxyReq.setHeader('Content-Type', 'text/plain');
                  }
                } catch (err) {
                  // Prevent crash on redirect
                }
              }
            });
          }
        }
      }
    }
  };
});
