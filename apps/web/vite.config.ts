import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The services' URLs default to their ports on this host; set API_URL/STORAGE_URL only for split hosts.
const apiUrl = process.env.API_URL || `http://localhost:${process.env.API_PORT || 4000}`
const storageUrl = process.env.STORAGE_URL || `http://localhost:${process.env.STORAGE_PORT || 4001}`

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
      '/api': { target: apiUrl, changeOrigin: true },
      '/storage': {
        target: storageUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/storage/, ''),
      },
    },
  },
})
