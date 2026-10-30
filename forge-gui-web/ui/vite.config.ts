import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// FORGE and TRACKER point the dev server at other ports. /api/v1 stands in for mtg-tracker, which shares the host in production.
const forge = process.env.FORGE ?? '127.0.0.1:7777'
const tracker = process.env.TRACKER ?? 'http://127.0.0.1:8000'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: `ws://${forge}`, ws: true },
      '/img': `http://${forge}`,
      '/api/v1': tracker,
    },
  },
})
