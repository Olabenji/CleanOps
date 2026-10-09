import { expect, test } from "@playwright/test";
import { loadDemoAccounts } from "../../scripts/demo-accounts.mjs";

test("resident can sign in and load account surfaces", async ({ page }) => {
  const demoAccounts = await loadDemoAccounts();
  const email = process.env.RESIDENT_SMOKE_EMAIL ?? demoAccounts.resident.email;
  const password = process.env.RESIDENT_SMOKE_PASSWORD ?? demoAccounts.resident.password;
  if (!password) {
    throw new Error("Set RESIDENT_SMOKE_PASSWORD or run npm run demo:passwords.");
  }

  await page.goto("/");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByText("CleanOps Resident")).toBeVisible();
  await expect(page.getByText("Your collection schedule")).toBeVisible();
  await expect(page.getByText("This month's account")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Missed collection & complaints" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay with Paystack" })).toBeVisible();
});
