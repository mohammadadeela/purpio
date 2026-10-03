import { test, expect } from "@playwright/test";
test("home renders the composer and pricing loads", async ({ page }) => {
  await page.goto("/"); await expect(page.getByRole("heading", { name: /What will you/ })).toBeVisible(); await expect(page.getByPlaceholder(/Describe your idea/)).toBeVisible();
  await page.goto("/pricing"); await expect(page.getByText("Most popular")).toBeVisible();
});
test("unauthenticated builder redirects to login", async ({ page }) => { await page.goto("/projects"); await expect(page).toHaveURL(/\/login/); });
