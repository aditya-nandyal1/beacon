import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'Beacon — emergency copilot',
        short_name: 'Beacon',
        description: 'Point your phone at the emergency. Beacon sees it, talks you through it, and gets help moving.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
        shortcuts: [{ name: 'Emergency now', url: '/?emergency=1', description: 'Open straight into an incident' }],
      },
      workbox: {
        // Protocols and the shell must work offline; API calls never cache.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [{ urlPattern: /^https:\/\/.*\.convex\.cloud\/.*/i, handler: 'NetworkOnly' }],
      },
    }),
  ],
  resolve: { alias: { '@convex': path.resolve(__dirname, '../../convex') } },
  server: { port: 5173, allowedHosts: ['.trycloudflare.com'] },
  build: { target: 'es2022', sourcemap: true },
});
