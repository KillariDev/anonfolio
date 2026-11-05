import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  workers: 1,
  use: { baseURL: process.env.BASE_URL || 'http://127.0.0.1:5173', headless: true },
  webServer: {
    command: process.env.BASE_URL ? 'bun run serve' : 'bun run dev --port 5173',
    url: process.env.BASE_URL || 'http://127.0.0.1:5173', reuseExistingServer: true,
  },
});
