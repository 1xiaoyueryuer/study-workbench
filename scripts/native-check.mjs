import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const electron = require("electron");
const result = spawnSync(
  electron,
  [
    "-e",
    "const D=require('better-sqlite3'); const db=new D(':memory:'); db.exec('create table t(v); insert into t values(1)'); console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,napi:process.versions.napi,sqlite:db.prepare('select sqlite_version() v').get(),row:db.prepare('select * from t').get()})); db.close();",
  ],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8" },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
process.exit(result.status ?? 1);
