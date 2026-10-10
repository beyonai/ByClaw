import { defineConfig } from '@playwright/test';
import path from 'node:path';

const timeout = 90000 + 5 * ((Number(process.env.BYCLAW_SMOKE_REPLY_TIMEOUT_SEC) || 120) + 120) * 1000;
export default defineConfig({
  testDir: './cases',
  workers: 1,
  retries: 0,
  timeout,
  globalTimeout: timeout + 60000,
  reporter: [['line']],
  outputDir: path.join(process.env.BYCLAW_SMOKE_RUN_DIR || 'results', 'playwright'),
  use: {
    headless: process.env.BYCLAW_SMOKE_HEADLESS !== 'false',
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    actionTimeout: 20000,
    navigationTimeout: 30000,
    // Login and API requests contain credentials: retain sanitized diagnostics instead.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    channel: process.env.BYCLAW_SMOKE_BROWSER_CHANNEL,
  },
});
