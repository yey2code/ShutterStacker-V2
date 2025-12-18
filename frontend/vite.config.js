import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8001', // Local development
        changeOrigin: true,
        secure: false,
        timeout: 300000,
        proxyTimeout: 300000,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/temp': {
        target: 'http://localhost:8001',
        changeOrigin: true
      }
    }
  }
})
