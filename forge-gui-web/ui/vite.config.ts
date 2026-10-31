import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// FORGE points the dev server at another game server port.
const forge = process.env.FORGE ?? '127.0.0.1:7777'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: `ws://${forge}`, ws: true },
      '/img': `http://${forge}`,
    },
  },
})
