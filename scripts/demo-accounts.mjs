import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const DEMO_ENV_PATH = resolve(process.cwd(), ".env.demo.local");

export const DEMO_ACCOUNT_SPECS = [
  {
    role: "operator",
    emailKey: "DEMO_OWNER_EMAIL",
    passwordKey: "DEMO_OWNER_PASSWORD",
    defaultEmail: "owner@cleanops.local",
    mobileEnvKey: null
  },
  {
    role: "driver",
    emailKey: "DEMO_DRIVER_EMAIL",
    passwordKey: "DEMO_DRIVER_PASSWORD",
    defaultEmail: "driver@cleanops.local",
    mobileEnvKey: "EXPO_PUBLIC_DEMO_DRIVER_PASSWORD"
  },
  {
    role: "collection_agent",
    emailKey: "DEMO_AGENT_EMAIL",
    passwordKey: "DEMO_AGENT_PASSWORD",
    defaultEmail: "agent@cleanops.local",
    mobileEnvKey: "EXPO_PUBLIC_DEMO_AGENT_PASSWORD"
  },
  {
    role: "resident",
    emailKey: "DEMO_RESIDENT_EMAIL",
    passwordKey: "DEMO_RESIDENT_PASSWORD",
    defaultEmail: "resident@cleanops.local",
    mobileEnvKey: "EXPO_PUBLIC_DEMO_RESIDENT_PASSWORD"
  },
  {
    role: "platform",
    emailKey: "DEMO_PLATFORM_EMAIL",
    passwordKey: "DEMO_PLATFORM_PASSWORD",
    defaultEmail: "platform@cleanops.local",
    mobileEnvKey: null
  },
  {
    role: "island",
    emailKey: "DEMO_ISLAND_EMAIL",
    passwordKey: "DEMO_ISLAND_PASSWORD",
    defaultEmail: "island.owner@cleanops.local",
    mobileEnvKey: null
  }
];

export function parseEnv(contents) {
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

export function sqlLiteral(value) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value)) {
    throw new Error("Demo passwords cannot contain newlines or null bytes.");
  }

  return `'${value.replaceAll("'", "''")}'`;
}

export function buildPasswordUpdateSql(email, password) {
  return `set search_path = public, extensions;
update auth.users
set encrypted_password = crypt(${sqlLiteral(password)}, gen_salt('bf')),
    updated_at = now()
where lower(email) = lower(${sqlLiteral(email)})
returning email;`;
}

function generatePassword() {
  return randomBytes(24).toString("hex");
}

function serializeDemoEnv(accounts) {
  const lines = [
    "# Local demo passwords. Gitignored. Created by npm run demo:passwords.",
    "# Do not commit this file."
  ];

  for (const spec of DEMO_ACCOUNT_SPECS) {
    const account = accounts[spec.role];
    lines.push(`${spec.emailKey}=${account.email}`);
    lines.push(`${spec.passwordKey}=${account.password}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export async function loadDemoAccounts({ generateMissing = false } = {}) {
  let fileValues = new Map();

  try {
    fileValues = parseEnv(await readFile(DEMO_ENV_PATH, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const accounts = {};
  let generated = false;

  for (const spec of DEMO_ACCOUNT_SPECS) {
    const email = (
      process.env[spec.emailKey] ||
      fileValues.get(spec.emailKey) ||
      spec.defaultEmail
    ).trim();
    let password = (process.env[spec.passwordKey] || fileValues.get(spec.passwordKey) || "").trim();

    if (!password && generateMissing) {
      password = generatePassword();
      generated = true;
    }

    if (password && password.length < 8) {
      throw new Error(`${spec.passwordKey} must be at least 8 characters.`);
    }

    accounts[spec.role] = {
      role: spec.role,
      email,
      password,
      emailKey: spec.emailKey,
      passwordKey: spec.passwordKey,
      mobileEnvKey: spec.mobileEnvKey
    };
  }

  if (generateMissing && (generated || fileValues.size === 0)) {
    await writeFile(DEMO_ENV_PATH, serializeDemoEnv(accounts), { mode: 0o600 });
  }

  return accounts;
}
