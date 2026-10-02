import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Large copies, SQLite audits and migration backups also run on shared CI VMs.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
