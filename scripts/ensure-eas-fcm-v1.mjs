#!/usr/bin/env node
/**
 * Non-interactive: ensure Expo Android FCM V1 credentials are linked for CleanOps.
 * Uses local Expo session (~/.expo/state.json) or EXPO_TOKEN.
 * Reads apps/mobile/fcm-service-account.json (gitignored).
 *
 * Usage: node scripts/ensure-eas-fcm-v1.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PROJECT_FULL_NAME = "@olabenji/cleanops";
const ANDROID_PACKAGE = "com.cleanops.app";
const ACCOUNT_NAME = "olabenji";
const GSA_PATH =
  process.env.FCM_SERVICE_ACCOUNT_JSON ??
  path.join(root, "apps/mobile/fcm-service-account.json");

function readSessionSecret() {
  if (process.env.EXPO_TOKEN?.trim()) {
    return { kind: "token", value: process.env.EXPO_TOKEN.trim() };
  }
  const statePath = path.join(os.homedir(), ".expo", "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const secret = state?.auth?.sessionSecret;
  if (!secret) {
    throw new Error("No Expo session. Run: npx eas-cli login");
  }
  return { kind: "session", value: secret };
}

async function graphql(auth, query, variables = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json"
  };
  if (auth.kind === "token") {
    headers.authorization = `Bearer ${auth.value}`;
  } else {
    headers["expo-session"] = auth.value;
  }

  const response = await fetch("https://api.expo.dev/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const detail = payload.errors?.map((e) => e.message).join("; ") ?? response.statusText;
    throw new Error(`Expo GraphQL failed: ${detail}`);
  }
  return payload.data;
}

async function main() {
  if (!fs.existsSync(GSA_PATH)) {
    throw new Error(
      `Missing FCM service account JSON at ${GSA_PATH}. See docs/expo-push-dev-build.md`
    );
  }

  const jsonKey = JSON.parse(fs.readFileSync(GSA_PATH, "utf8"));
  if (!jsonKey.private_key || !jsonKey.client_email) {
    throw new Error("FCM JSON is missing private_key or client_email");
  }

  const auth = readSessionSecret();
  console.log(`Using Expo auth via ${auth.kind}; checking ${PROJECT_FULL_NAME}…`);

  const status = await graphql(
    auth,
    `
      query FcmStatus($fullName: String!, $applicationIdentifier: String) {
        app {
          byFullName(fullName: $fullName) {
            id
            androidAppCredentials(
              filter: { applicationIdentifier: $applicationIdentifier, legacyOnly: false }
            ) {
              id
              applicationIdentifier
              googleServiceAccountKeyForFcmV1 {
                id
                clientEmail
                projectIdentifier
              }
            }
          }
        }
        account {
          byName(accountName: "${ACCOUNT_NAME}") {
            id
            name
          }
        }
      }
    `,
    { fullName: PROJECT_FULL_NAME, applicationIdentifier: ANDROID_PACKAGE }
  );

  const app = status.app?.byFullName;
  const account = status.account?.byName;
  if (!app?.id || !account?.id) {
    throw new Error("Could not resolve Expo app or account");
  }

  let credentials = app.androidAppCredentials?.[0] ?? null;
  const existing = credentials?.googleServiceAccountKeyForFcmV1;
  if (existing?.id) {
    console.log(
      `FCM V1 already linked: ${existing.clientEmail} (project ${existing.projectIdentifier})`
    );
    console.log("OK — no upload needed");
    return;
  }

  console.log("FCM V1 not linked — creating Google Service Account key on Expo…");

  if (!credentials?.id) {
    const created = await graphql(
      auth,
      `
        mutation CreateAndroidCreds(
          $appId: ID!
          $applicationIdentifier: String!
          $input: AndroidAppCredentialsInput!
        ) {
          androidAppCredentials {
            createAndroidAppCredentials(
              androidAppCredentialsInput: $input
              appId: $appId
              applicationIdentifier: $applicationIdentifier
            ) {
              id
            }
          }
        }
      `,
      {
        appId: app.id,
        applicationIdentifier: ANDROID_PACKAGE,
        input: {}
      }
    );
    credentials = created.androidAppCredentials.createAndroidAppCredentials;
    console.log(`Created Android app credentials ${credentials.id}`);
  }

  const keyResult = await graphql(
    auth,
    `
      mutation CreateGsa($accountId: ID!, $googleServiceAccountKeyInput: GoogleServiceAccountKeyInput!) {
        googleServiceAccountKey {
          createGoogleServiceAccountKey(
            accountId: $accountId
            googleServiceAccountKeyInput: $googleServiceAccountKeyInput
          ) {
            id
            clientEmail
            projectIdentifier
          }
        }
      }
    `,
    {
      accountId: account.id,
      googleServiceAccountKeyInput: { jsonKey }
    }
  );

  const key = keyResult.googleServiceAccountKey.createGoogleServiceAccountKey;
  console.log(`Uploaded key ${key.id} (${key.clientEmail})`);

  const linked = await graphql(
    auth,
    `
      mutation LinkFcmV1($id: ID!, $googleServiceAccountKeyId: ID!) {
        androidAppCredentials {
          setGoogleServiceAccountKeyForFcmV1(
            id: $id
            googleServiceAccountKeyId: $googleServiceAccountKeyId
          ) {
            id
            googleServiceAccountKeyForFcmV1 {
              id
              clientEmail
              projectIdentifier
            }
          }
        }
      }
    `,
    {
      id: credentials.id,
      googleServiceAccountKeyId: key.id
    }
  );

  const linkedKey =
    linked.androidAppCredentials.setGoogleServiceAccountKeyForFcmV1
      .googleServiceAccountKeyForFcmV1;
  console.log(
    `Linked FCM V1: ${linkedKey.clientEmail} (project ${linkedKey.projectIdentifier})`
  );
  console.log("OK — FCM V1 credentials ready for Expo push delivery");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
