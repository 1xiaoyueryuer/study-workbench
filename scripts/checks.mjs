import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const results = [];
mkdirSync(".artifacts/tests/checks", { recursive: true });
for (const name of [
  "typecheck",
  "lint",
  "test",
  "test:integration",
  "build",
  "test:e2e",
]) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", name],
    {
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 8 * 1024 ** 2,
    },
  );
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const record = {
    command: "npm run " + name,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.status,
  };
  results.push(record);
  writeFileSync(
    `.artifacts/tests/checks/${name.replaceAll(":", "-")}.txt`,
    output,
  );
  writeFileSync(
    ".artifacts/tests/checks.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(record));
  if (result.status !== 0) {
    console.log(output);
    process.exit(result.status ?? 1);
  }
}
