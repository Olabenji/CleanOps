import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { buildPasswordUpdateSql, parseEnv, sqlLiteral } from "./demo-accounts.mjs";

const root = new URL("..", import.meta.url).pathname;
const textExtensions = new Set([
  ".sql",
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".py",
  ".csv",
  ".html",
  ".yml",
  ".yaml",
  ".json",
  ".example",
  ".toml"
]);

const allowedOldNameFiles = new Set([
  "supabase/migrations/0069_fleet_dumpsite_maintenance.sql",
  "supabase/migrations/0084_rename_demo_operator.sql"
]);

const oldCompany = ["Next", "to", "Godliness"].join(" ");
const oldSlug = ["next", "to", "godliness"].join("-");
const oldPasswords = [
  ["cleanops", "demo", "password"].join("-"),
  ["cleanops", "driver", "password"].join("-"),
  ["cleanops", "agent", "password"].join("-"),
  ["cleanops", "platform", "password"].join("-"),
  ["cleanops", "island", "password"].join("-"),
  ["cleanops", "resident", "password"].join("-")
];

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "output") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

test("seed and docs do not publish the real operator name or demo passwords", async () => {
  const files = await walk(root);
  const hits = [];

  for (const file of files) {
    const rel = relative(root, file);
    const dot = file.lastIndexOf(".");
    const ext = dot >= 0 ? file.slice(dot) : "";
    if (!textExtensions.has(ext) && !file.endsWith(".env.example") && !file.endsWith("demo.env.example")) {
      continue;
    }
    if (rel.endsWith("demo-seed-hygiene.test.mjs") || rel.endsWith("package-lock.json")) {
      continue;
    }

    const text = await readFile(file, "utf8");
    const nameHit = text.includes(oldCompany) || text.includes(oldSlug);
    const passwordHit = oldPasswords.some((password) => text.includes(password));
    if (!nameHit && !passwordHit) {
      continue;
    }
    if (nameHit && !passwordHit && allowedOldNameFiles.has(rel)) {
      continue;
    }
    hits.push(rel);
  }

  assert.deepEqual(hits, []);
});

test("password update SQL quotes quotes and rejects newlines", () => {
  assert.equal(sqlLiteral("a'b"), "'a''b'");
  assert.match(buildPasswordUpdateSql("owner@cleanops.local", "secret"), /crypt\('secret'/);
  assert.throws(() => sqlLiteral("bad\npassword"));
});

test("demo env example declares password keys without values", async () => {
  const example = parseEnv(await readFile(join(root, "demo.env.example"), "utf8"));
  for (const key of [
    "DEMO_OWNER_PASSWORD",
    "DEMO_DRIVER_PASSWORD",
    "DEMO_AGENT_PASSWORD",
    "DEMO_RESIDENT_PASSWORD",
    "DEMO_PLATFORM_PASSWORD",
    "DEMO_ISLAND_PASSWORD"
  ]) {
    assert.equal(example.get(key), "");
  }
  assert.equal(example.get("DEMO_OWNER_EMAIL"), "owner@cleanops.local");
});
