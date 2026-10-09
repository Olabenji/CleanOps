#!/usr/bin/env node
/**
 * Set local demo Auth passwords from gitignored `.env.demo.local`.
 *
 * Seed inserts the users with a random password. This script replaces those
 * passwords from the env file (creating the file with random values when
 * passwords are missing) and mirrors the field-app passwords into
 * `apps/mobile/.env.local` for one-tap demo sign-in.
 *
 *   npm run demo:passwords
 *   node scripts/apply-demo-passwords.mjs --export-github-env
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  DEMO_ACCOUNT_SPECS,
  buildPasswordUpdateSql,
  loadDemoAccounts,
  parseEnv
} from "./demo-accounts.mjs";

const container = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_cleanops";
const mobileEnvPath = resolve(process.cwd(), "apps/mobile/.env.local");

function upsertEnvFile(filePath, updates) {
  let existing = "";
  try {
    existing = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const values = parseEnv(existing);
  for (const [key, value] of Object.entries(updates)) {
    values.set(key, value);
  }

  const preserved = [];
  const seen = new Set();
  for (const rawLine of existing.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      preserved.push(rawLine);
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      preserved.push(rawLine);
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    preserved.push(`${key}=${values.get(key) ?? ""}`);
    values.delete(key);
  }

  if (preserved.length > 0 && preserved.at(-1) !== "") {
    preserved.push("");
  }
  for (const [key, value] of values) {
    preserved.push(`${key}=${value}`);
  }
  if (preserved.at(-1) !== "") {
    preserved.push("");
  }

  writeFileSync(filePath, preserved.join("\n"), { mode: 0o600 });
}

function applyPassword(email, password) {
  const sql = buildPasswordUpdateSql(email, password);
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      encoding: "utf8",
      input: sql
    }
  );

  if (result.error) {
    throw result.error;
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`Failed to update ${email} in ${container}.\n${output}`);
  }

  const updated = (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("@"));

  if (updated.length !== 1) {
    throw new Error(
      `Expected to update 1 local user for ${email}, updated ${updated.length}. Is local Supabase running with seed data?`
    );
  }
}

const accounts = await loadDemoAccounts({ generateMissing: true });

for (const spec of DEMO_ACCOUNT_SPECS) {
  const account = accounts[spec.role];
  if (!account.password) {
    throw new Error(`${spec.passwordKey} is empty.`);
  }
  applyPassword(account.email, account.password);
}

const mobileUpdates = {};
for (const account of Object.values(accounts)) {
  if (account.mobileEnvKey) {
    mobileUpdates[account.mobileEnvKey] = account.password;
  }
}
upsertEnvFile(mobileEnvPath, mobileUpdates);

if (process.argv.includes("--export-github-env")) {
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) {
    throw new Error("--export-github-env requires GITHUB_ENV.");
  }

  const lines = [
    `RESIDENT_SMOKE_EMAIL=${accounts.resident.email}`,
    `RESIDENT_SMOKE_PASSWORD=${accounts.resident.password}`
  ];
  for (const account of Object.values(accounts)) {
    lines.push(`${account.emailKey}=${account.email}`);
    lines.push(`${account.passwordKey}=${account.password}`);
  }
  appendFileSync(githubEnv, `${lines.join("\n")}\n`);
}

console.log(
  `Updated ${DEMO_ACCOUNT_SPECS.length} local demo passwords in ${container}. Values are in .env.demo.local (not printed).`
);
