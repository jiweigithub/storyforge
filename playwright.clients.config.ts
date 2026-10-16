import { defineConfig } from '@playwright/test'
// Exercise the actual production-only consent gate in isolated browser storage.
process.env.PLAYWRIGHT_PRODUCTION_PREVIEW = '1'
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'client-support.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4182/storyforge/', trace: 'retain-on-failure', ...(process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1' ? { channel: 'chrome' } : {}) },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4182 --strictPort --outDir dist-client-verification', url: 'http://127.0.0.1:4182/storyforge/', reuseExistingServer: false, timeout: 120000 },
})
