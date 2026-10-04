import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.e2e.spec.ts',
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [
    [
      'list',
    ],
    [
      'html',
      {
        open: 'never',
      },
    ],
  ],
  use: {
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
