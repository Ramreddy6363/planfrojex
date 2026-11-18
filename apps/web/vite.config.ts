import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'public-share-security-headers',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0]?.startsWith('/share/')) {
            response.setHeader('X-Robots-Tag', 'noindex')
            response.setHeader('Referrer-Policy', 'no-referrer')
          }
          next()
        })
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0]?.startsWith('/share/')) {
            response.setHeader('X-Robots-Tag', 'noindex')
            response.setHeader('Referrer-Policy', 'no-referrer')
          }
          next()
        })
      },
    },
  ],
  test: { include: ['src/**/*.test.ts'] },
})
