import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: '**/*.e2e.ts', timeout: 30000, use: { browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 } }, workers: 1 });
