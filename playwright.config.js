// playwright.config.js

const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["list"],                                        
    ["html", { outputFolder: "playwright-report", open: "never" }], 
    ["json", { outputFile: "test-results/playwright_results.json" }],
  ],
  use: {
    headless: false,   
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  outputDir: "test-results/artifacts",
});