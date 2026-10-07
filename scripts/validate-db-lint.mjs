#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

export function parseSupabaseLintOutput(stdout, stderr = "") {
  const fromLine = findResultsLine(stdout) ?? findResultsLine(stderr);
  if (fromLine) {
    return fromLine;
  }

  const fromDocument = parseJsonDocument(stdout) ?? parseJsonDocument(stderr);
  if (fromDocument) {
    return fromDocument;
  }

  const combined = `${stdout ?? ""}\n${stderr ?? ""}`;
  throw new Error(`Unable to parse Supabase lint output:\n${combined}`);
}

export function evaluateSupabaseLint({ status, stdout, stderr }) {
  const report = parseSupabaseLintOutput(stdout, stderr);
  const results = Array.isArray(report.results) ? report.results : [];

  if (status !== 0 && results.length === 0) {
    const combined = `${stdout ?? ""}\n${stderr ?? ""}`;
    throw new Error(
      `Supabase lint exited with status ${status} and no results.\n${combined}`
    );
  }

  return classifyLintResults(results);
}

function findResultsLine(text) {
  if (!text) {
    return null;
  }

  const jsonLine = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.startsWith('{"results":'));

  if (!jsonLine) {
    return null;
  }

  try {
    const report = JSON.parse(jsonLine);
    if (!report || !Array.isArray(report.results)) {
      return null;
    }
    return report;
  } catch {
    return null;
  }
}

function parseJsonDocument(text) {
  const source = String(text ?? "").trim();
  if (!source) {
    return null;
  }

  const direct = tryParseReport(source);
  if (direct) {
    return direct;
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== "[" && character !== "{") {
      continue;
    }

    const parsed = tryParseReport(source.slice(index));
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function tryParseReport(text) {
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value)) {
      return { results: value };
    }
    if (value && typeof value === "object" && Array.isArray(value.results)) {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

function classifyLintResults(results) {
  const applicationErrors = results.filter(
    (entry) =>
      !extensionFunctions.has(entry.function) &&
      entry.issues.some((issue) => issue.level === "error")
  );
  const ignoredExtensionErrors = results.filter(
    (entry) =>
      extensionFunctions.has(entry.function) &&
      entry.issues.some((issue) => issue.level === "error")
  );

  return { applicationErrors, ignoredExtensionErrors };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return import.meta.url === pathToFileURL(entry).href;
}

function runCli() {
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

  const outcome = evaluateSupabaseLint({
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  });

  if (outcome.applicationErrors.length > 0) {
    console.error(JSON.stringify({ results: outcome.applicationErrors }, null, 2));
    process.exit(1);
  }

  console.log(
    `DB LINT PASS (ignored ${outcome.ignoredExtensionErrors.length} PostGIS-owned findings)`
  );
}

if (isDirectRun()) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
