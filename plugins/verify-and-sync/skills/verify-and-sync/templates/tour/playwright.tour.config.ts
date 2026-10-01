import { defineConfig } from '@playwright/test';
// Reuse your e2e config (base URL, web server, global sign-in setup). Adjust the import if yours has another name.
import base from './playwright.config';

/**
 * verify-and-sync · screen tour config (copy to the project root).
 * Run: `npx playwright test --config playwright.tour.config.ts` (after your build, if your web server needs one).
 * The gallery is written to .verify/tour/index.html (override with TOUR_OUT).
 */
export default defineConfig({
  ...base,
  testDir: 'tests/tour',
  // Not your e2e output folder: Playwright empties its output folder first, which would erase e2e failure evidence.
  outputDir: '.verify/tour-output',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30 * 60_000,
});
