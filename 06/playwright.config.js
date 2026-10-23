const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

const databasePath = path.join(__dirname, ".e2e", "taskboard.db");

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "cargo run --quiet --manifest-path server/Cargo.toml",
    url: "http://127.0.0.1:3100/api/health",
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: "3100",
      TASKBOARD_HOST: "127.0.0.1",
      TASKBOARD_DB_PATH: databasePath,
      TASKBOARD_RESET_DB: "1",
      TASKBOARD_SEED: "0",
    },
  },
});
