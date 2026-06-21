import { defineConfig, devices } from '@playwright/test'

// Screenshot (visual-regression) tests. The dev server (vite, strictPort 8788)
// serves /contents from the local contents/ folder, so clips + framings load for
// real. Animated pages are frozen deterministically via ?test=1 (see Preview.tsx /
// Stage.tsx freezeAt). Baselines live in tests/__screenshots__ and are committed.
export default defineConfig({
  testDir: './tests',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8788',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1, // pin dpr so canvas backing size is stable across machines
  },
  // GPU/driver shader output varies slightly; allow a small per-pixel budget.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    port: 8788,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
