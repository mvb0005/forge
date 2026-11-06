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
    // A table's page is /<match id>/ (tools/start.mjs --ui), so its socket and images are under it too.
    proxy: {
      '^/([0-9a-f]{16}/)?ws': { target: `ws://${forge}`, ws: true },
      '^/([0-9a-f]{16}/)?img/': `http://${forge}`,
    },
  },
})
