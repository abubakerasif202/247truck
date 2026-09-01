import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:3100',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
  },
});
