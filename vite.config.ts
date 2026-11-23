import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { transform as esbuildTransform } from 'esbuild';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function legacyChunkCompatPlugin(): Plugin {
  return {
    name: 'legacy-chunk-compat',
    apply: 'build',
    async renderChunk(code) {
      const result = await esbuildTransform(code, {
        loader: 'js',
        format: 'esm',
        target: ['chrome79', 'safari13.1', 'firefox75', 'edge79'],
        minify: true,
      });
      return {
        code: result.code,
        map: result.map || null,
      };
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      legacyChunkCompatPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          id: '/',
          name: 'TH3 BNB Servicio Técnico',
          short_name: 'TH3 BNB',
          description: 'Sistema integral de gestión para taller técnico, reparaciones, clientes, inventario y ventas.',
          theme_color: '#0072BB',
          background_color: '#F8FAFC',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          importScripts: ['/sw-notifications.js'],
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/api\//],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: ['**/aistudio/**'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      target: ['es2020', 'chrome80', 'safari13.1', 'firefox78'],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
