import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: '**/*.e2e.spec.ts',
  projects: [
    {
      name: 'app',
      testDir: './src',
    },
    {
      name: 'package',
      testDir: './tests',
    },
  ],
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
});
