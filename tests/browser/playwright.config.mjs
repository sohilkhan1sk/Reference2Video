import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.mjs",
  reporter: "line",
  timeout: 30000,
  expect: { timeout: 8000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required"]
    }
  },
  webServer: {
    command: "node preview-server.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 15000
  }
});
