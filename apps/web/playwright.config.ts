import { defineConfig } from '@playwright/test'

// Minimal declaration: avoids adding @types/node for one variable.
declare const process: { env: Record<string, string | undefined> }
const port = process.env.PLAYWRIGHT_PORT ?? '5199'

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/design.html`,
    reuseExistingServer: !process.env.CI,
  },
})
