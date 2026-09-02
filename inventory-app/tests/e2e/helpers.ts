import { expect, type Locator, type Page } from '@playwright/test';

import { E2E_PASSWORD } from './fixtures';

/** `role="alert"` scoped to real page alerts, not Next's route announcer div. */
export function formAlert(page: Page): Locator {
  return page.locator('p[role="alert"], span[role="alert"], div.text-destructive[role="alert"]');
}

export function formStatus(page: Page): Locator {
  return page.locator('[role="status"]');
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}
