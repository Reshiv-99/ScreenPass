import 'dotenv/config'

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  use: {baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, trace: 'retain-on-failure'},
  workers: 1,
})
