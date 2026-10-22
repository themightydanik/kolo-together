import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({
  ...base,
  testMatch: 'activity-local.spec.ts',
  timeout: 90000,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4174' },
})
