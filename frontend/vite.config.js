import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000', // Local development
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/temp': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})
