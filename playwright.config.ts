import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3130);
const BASE_URL = `http://localhost:${PORT}`;

const loopbackHosts = 'localhost,127.0.0.1,::1';
process.env.NO_PROXY = process.env.NO_PROXY
  ? `${process.env.NO_PROXY},${loopbackHosts}`
  : loopbackHosts;
process.env.no_proxy = process.env.no_proxy
  ? `${process.env.no_proxy},${loopbackHosts}`
  : loopbackHosts;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    // Coach marks (premium §2.4) start dismissed so they never cover controls in other specs;
    // coach-marks-p25.spec.ts clears this to test them.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [{ name: 'cal.hints.v1', value: '["h-show","h-hover","h-strip"]' }],
        },
      ],
    },
    colorScheme: 'dark',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: `sh -c '[ -f .next/BUILD_ID ] || npx next build; exec npx next start -p ${PORT}'`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
