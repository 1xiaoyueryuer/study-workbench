import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: ".artifacts/tests/playwright/results",
  timeout: 120000,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: ".artifacts/tests/playwright/report" },
    ],
  ],
  use: { trace: "retain-on-failure" },
});
