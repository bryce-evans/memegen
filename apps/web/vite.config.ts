import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Deps of linked workspace packages are found late; pre-bundle them so Vite doesn't
  // re-optimize and reload the page the first time the editor opens.
  optimizeDeps: {
    include: [
      '@memegen/render > mediabunny',
      '@memegen/render > gifuct-js',
      '@memegen/render > gifenc',
      '@memegen/shared > zod',
    ],
  },
  server: {
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: true },
      '/storage': {
        target: process.env.STORAGE_URL ?? 'http://localhost:4001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/storage/, ''),
      },
    },
  },
})
