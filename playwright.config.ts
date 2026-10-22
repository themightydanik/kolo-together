import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './browser',
  testMatch: 'experience.spec.ts',
  timeout: 30000,
  expect: { timeout: 7000, toHaveScreenshot: { maxDiffPixelRatio: 0.015 } },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 390, height: 844 },
    locale: 'uk-UA',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
          args: ['--no-sandbox'],
        },
      },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
