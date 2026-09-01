import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // JOBHUNT_API lets a dev server point at a scratch backend (demo scripts)
        target: process.env.JOBHUNT_API || 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
