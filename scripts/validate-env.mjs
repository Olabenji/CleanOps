#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ??
  "example";

const requiredKeys = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_WEB_APP_URL",
  "EXPO_PUBLIC_EAS_PROJECT_ID",
  "EXPO_PUBLIC_SENTRY_DSN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PAYSTACK_SECRET_KEY",
  "SITE_URL"
];

function parseEnvFile(contents) {
  const result = new Map();

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator > 0) {
      result.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
  }

  return result;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

if (mode === "example") {
  const example = parseEnvFile(
    await readFile(resolve(process.cwd(), ".env.example"), "utf8")
  );
  const missing = requiredKeys.filter((key) => !example.has(key));

  if (missing.length > 0) {
    throw new Error(`.env.example is missing required keys: ${missing.join(", ")}`);
  }

  console.log(`ENV EXAMPLE PASS (${requiredKeys.length} required keys declared)`);
} else if (mode === "production") {
  const values = Object.fromEntries(
    requiredKeys.map((key) => [key, process.env[key]?.trim() ?? ""])
  );
  const errors = [];

  for (const key of requiredKeys) {
    if (!values[key]) {
      errors.push(`${key} is required`);
    }
  }

  for (const key of [
    "EXPO_PUBLIC_SUPABASE_URL",
    "EXPO_PUBLIC_WEB_APP_URL",
    "SUPABASE_URL",
    "SITE_URL",
    "EXPO_PUBLIC_SENTRY_DSN"
  ]) {
    if (values[key] && !isHttpsUrl(values[key])) {
      errors.push(`${key} must be an https URL`);
    }
  }

  if (
    values.EXPO_PUBLIC_EAS_PROJECT_ID &&
    !isUuid(values.EXPO_PUBLIC_EAS_PROJECT_ID)
  ) {
    errors.push("EXPO_PUBLIC_EAS_PROJECT_ID must be a UUID");
  }

  if (
    values.PAYSTACK_SECRET_KEY &&
    !/^sk_(test|live)_[A-Za-z0-9]+$/.test(values.PAYSTACK_SECRET_KEY)
  ) {
    errors.push("PAYSTACK_SECRET_KEY must be a Paystack sk_test_... or sk_live_... key");
  }

  for (const key of ["EXPO_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (values[key] && values[key].length < 32) {
      errors.push(`${key} is too short`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Production environment validation failed:\n- ${errors.join("\n- ")}`);
  }

  console.log("PRODUCTION ENV PASS");
} else {
  throw new Error(`Unknown validation mode: ${mode}`);
}
