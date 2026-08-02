import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 0 : 1,
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 1),
  reporter: process.env.CI ? [['github'], ['html']] : 'list',
  use: {
    baseURL: 'http://localhost:15173',
    trace: process.env.PLAYWRIGHT_CAPTURE_EVIDENCE === '0' ? 'off' : 'on',
    screenshot: process.env.PLAYWRIGHT_CAPTURE_EVIDENCE === '0' ? 'off' : 'on',
    video: process.env.PLAYWRIGHT_CAPTURE_EVIDENCE === '0' ? 'off' : 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
