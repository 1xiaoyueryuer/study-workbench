import { build } from "esbuild";
await build({
  entryPoints: ["src/main/main.ts", "src/main/preload.ts"],
  outdir: ".artifacts/build/main",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron", "better-sqlite3"],
});
