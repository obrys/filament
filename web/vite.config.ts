import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5113', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:5113', ws: true },
    },
  },
})
