#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const extensionFunctions = new Set([
  "public.addauth",
  "public.addgeometrycolumn",
  "public.dropgeometrycolumn",
  "public.dropgeometrytable",
  "public.enablelongtransactions",
  "public.lockrow",
  "public.longtransactionsenabled",
  "public.populate_geometry_columns",
  "public.postgis_full_version",
  "public.st_findextent",
  "public.st_letters",
  "public.updategeometrysrid"
]);

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  executable,
  ["supabase", "db", "lint", "--local", "--level", "error"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32"
  }
);

if (result.error) {
  throw result.error;
}

const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const jsonLine = combined
  .split(/\r?\n/)
  .map((line) => line.trim())
  .findLast((line) => line.startsWith('{"results":'));

if (!jsonLine) {
  throw new Error(`Unable to parse Supabase lint output:\n${combined}`);
}

const report = JSON.parse(jsonLine);
const applicationErrors = report.results.filter(
  (entry) =>
    !extensionFunctions.has(entry.function) &&
    entry.issues.some((issue) => issue.level === "error")
);
const ignoredExtensionErrors = report.results.filter(
  (entry) =>
    extensionFunctions.has(entry.function) &&
    entry.issues.some((issue) => issue.level === "error")
);

if (applicationErrors.length > 0) {
  console.error(JSON.stringify({ results: applicationErrors }, null, 2));
  process.exit(1);
}

console.log(
  `DB LINT PASS (ignored ${ignoredExtensionErrors.length} PostGIS-owned findings)`
);
