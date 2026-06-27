import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiBaseUrl = process.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1'
const apiOrigin = new URL(apiBaseUrl).origin
const allowedHosts = [
  '.up.railway.app',
  ...(process.env.VITE_ALLOWED_HOSTS?.split(',').map((host) => host.trim()).filter(Boolean) ?? []),
]

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    allowedHosts,
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
      },
    },
  },
  preview: {
    allowedHosts,
  },
})
