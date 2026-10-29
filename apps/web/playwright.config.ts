import { defineConfig } from '@playwright/test'

// Minimal declaration: avoids adding @types/node for one variable.
declare const process: { env: Record<string, string | undefined> }

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:5199' },
  webServer: {
    command: 'pnpm exec vite --port 5199 --strictPort',
    url: 'http://localhost:5199/design.html',
    reuseExistingServer: !process.env.CI,
  },
})
