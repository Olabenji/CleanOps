#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const container = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_cleanops";
const smokeFiles = [
  "scripts/smoke_make_good.sql",
  "scripts/smoke_unserviced_recovery.sql"
];

for (const file of smokeFiles) {
  const sql = await readFile(resolve(process.cwd(), file), "utf8");
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1"
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: sql,
      shell: process.platform === "win32"
    }
  );

  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");

  if (result.error) {
    throw result.error;
  }

  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || !combined.includes("SMOKE PASS")) {
    throw new Error(`${file} failed with exit code ${result.status}`);
  }

  console.log(`${file}: PASS`);
}
