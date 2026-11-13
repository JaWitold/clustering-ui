import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fixturesApi } from './fixtures/mockApi.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.FIXTURES ? [fixturesApi()] : [])],
  server: {
    port: 5173,
    proxy: {
      '/v2.0': {
        target: 'http://localhost:2080',
        changeOrigin: true,
      },
    },
  },
})
