// vite.config.js
import { defineConfig, loadEnv } from "file:///E:/Google%20Antigravity/HuyDongVon/node_modules/vite/dist/node/index.js";
import { viteSingleFile } from "file:///E:/Google%20Antigravity/HuyDongVon/node_modules/vite-plugin-singlefile/dist/esm/index.js";
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const targetUrl = env.APPS_SCRIPT_URL || "";
  return {
    plugins: [viteSingleFile()],
    build: {
      assetsInlineLimit: 1e8,
      chunkSizeWarningLimit: 1e8,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    },
    server: {
      proxy: {
        "/api/data": {
          target: targetUrl ? targetUrl + (targetUrl.includes("?") ? "&" : "?") + "action=getData" : "http://localhost",
          changeOrigin: true,
          followRedirects: true,
          rewrite: () => "",
          configure: (proxy, options) => {
            proxy.on("proxyReq", (proxyReq, req, res) => {
              if (req.method === "POST") {
                try {
                  if (!proxyReq.headersSent && typeof proxyReq.getHeader === "function" && !proxyReq.getHeader("Content-Type")) {
                    proxyReq.setHeader("Content-Type", "text/plain");
                  }
                } catch (err) {
                }
              }
            });
          }
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxHb29nbGUgQW50aWdyYXZpdHlcXFxcSHV5RG9uZ1ZvblwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRTpcXFxcR29vZ2xlIEFudGlncmF2aXR5XFxcXEh1eURvbmdWb25cXFxcdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0U6L0dvb2dsZSUyMEFudGlncmF2aXR5L0h1eURvbmdWb24vdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IHZpdGVTaW5nbGVGaWxlIH0gZnJvbSAndml0ZS1wbHVnaW4tc2luZ2xlZmlsZSc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+IHtcbiAgLy8gTG9hZCBlbnYgdmFyaWFibGVzXG4gIGNvbnN0IGVudiA9IGxvYWRFbnYobW9kZSwgcHJvY2Vzcy5jd2QoKSwgJycpO1xuICBjb25zdCB0YXJnZXRVcmwgPSBlbnYuQVBQU19TQ1JJUFRfVVJMIHx8ICcnO1xuXG4gIHJldHVybiB7XG4gICAgcGx1Z2luczogW3ZpdGVTaW5nbGVGaWxlKCldLFxuICAgIGJ1aWxkOiB7XG4gICAgICBhc3NldHNJbmxpbmVMaW1pdDogMTAwMDAwMDAwLFxuICAgICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiAxMDAwMDAwMDAsXG4gICAgICBjc3NDb2RlU3BsaXQ6IGZhbHNlLFxuICAgICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgICBvdXRwdXQ6IHtcbiAgICAgICAgICBpbmxpbmVEeW5hbWljSW1wb3J0czogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBzZXJ2ZXI6IHtcbiAgICAgIHByb3h5OiB7XG4gICAgICAgICcvYXBpL2RhdGEnOiB7XG4gICAgICAgICAgdGFyZ2V0OiB0YXJnZXRVcmwgXG4gICAgICAgICAgICA/IHRhcmdldFVybCArICh0YXJnZXRVcmwuaW5jbHVkZXMoJz8nKSA/ICcmJyA6ICc/JykgKyAnYWN0aW9uPWdldERhdGEnIFxuICAgICAgICAgICAgOiAnaHR0cDovL2xvY2FsaG9zdCcsXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICAgIGZvbGxvd1JlZGlyZWN0czogdHJ1ZSxcbiAgICAgICAgICByZXdyaXRlOiAoKSA9PiAnJyxcbiAgICAgICAgICBjb25maWd1cmU6IChwcm94eSwgb3B0aW9ucykgPT4ge1xuICAgICAgICAgICAgcHJveHkub24oJ3Byb3h5UmVxJywgKHByb3h5UmVxLCByZXEsIHJlcykgPT4ge1xuICAgICAgICAgICAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ1BPU1QnKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGlmICghcHJveHlSZXEuaGVhZGVyc1NlbnQgJiYgdHlwZW9mIHByb3h5UmVxLmdldEhlYWRlciA9PT0gJ2Z1bmN0aW9uJyAmJiAhcHJveHlSZXEuZ2V0SGVhZGVyKCdDb250ZW50LVR5cGUnKSkge1xuICAgICAgICAgICAgICAgICAgICBwcm94eVJlcS5zZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScsICd0ZXh0L3BsYWluJyk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAvLyBQcmV2ZW50IGNyYXNoIG9uIHJlZGlyZWN0XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH07XG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBMFIsU0FBUyxjQUFjLGVBQWU7QUFDaFUsU0FBUyxzQkFBc0I7QUFFL0IsSUFBTyxzQkFBUSxhQUFhLENBQUMsRUFBRSxLQUFLLE1BQU07QUFFeEMsUUFBTSxNQUFNLFFBQVEsTUFBTSxRQUFRLElBQUksR0FBRyxFQUFFO0FBQzNDLFFBQU0sWUFBWSxJQUFJLG1CQUFtQjtBQUV6QyxTQUFPO0FBQUEsSUFDTCxTQUFTLENBQUMsZUFBZSxDQUFDO0FBQUEsSUFDMUIsT0FBTztBQUFBLE1BQ0wsbUJBQW1CO0FBQUEsTUFDbkIsdUJBQXVCO0FBQUEsTUFDdkIsY0FBYztBQUFBLE1BQ2QsZUFBZTtBQUFBLFFBQ2IsUUFBUTtBQUFBLFVBQ04sc0JBQXNCO0FBQUEsUUFDeEI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLElBQ0EsUUFBUTtBQUFBLE1BQ04sT0FBTztBQUFBLFFBQ0wsYUFBYTtBQUFBLFVBQ1gsUUFBUSxZQUNKLGFBQWEsVUFBVSxTQUFTLEdBQUcsSUFBSSxNQUFNLE9BQU8sbUJBQ3BEO0FBQUEsVUFDSixjQUFjO0FBQUEsVUFDZCxpQkFBaUI7QUFBQSxVQUNqQixTQUFTLE1BQU07QUFBQSxVQUNmLFdBQVcsQ0FBQyxPQUFPLFlBQVk7QUFDN0Isa0JBQU0sR0FBRyxZQUFZLENBQUMsVUFBVSxLQUFLLFFBQVE7QUFDM0Msa0JBQUksSUFBSSxXQUFXLFFBQVE7QUFDekIsb0JBQUk7QUFDRixzQkFBSSxDQUFDLFNBQVMsZUFBZSxPQUFPLFNBQVMsY0FBYyxjQUFjLENBQUMsU0FBUyxVQUFVLGNBQWMsR0FBRztBQUM1Ryw2QkFBUyxVQUFVLGdCQUFnQixZQUFZO0FBQUEsa0JBQ2pEO0FBQUEsZ0JBQ0YsU0FBUyxLQUFLO0FBQUEsZ0JBRWQ7QUFBQSxjQUNGO0FBQUEsWUFDRixDQUFDO0FBQUEsVUFDSDtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
