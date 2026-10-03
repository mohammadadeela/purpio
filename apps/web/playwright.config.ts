import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "tests", use: { baseURL: process.env.APP_URL ?? "http://localhost:3000" }, webServer: { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true } });
