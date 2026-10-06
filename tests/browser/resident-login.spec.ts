import { expect, test } from "@playwright/test";

test("resident can sign in and load account surfaces", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Email").fill("resident@cleanops.local");
  await page.getByLabel("Password").fill("cleanops-resident-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByText("CleanOps Resident")).toBeVisible();
  await expect(page.getByText("Your collection schedule")).toBeVisible();
  await expect(page.getByText("This month's account")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Missed collection & complaints" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay with Paystack" })).toBeVisible();
});
