import type { Page } from '@playwright/test';

export async function openAddressForm(page: Page) {
  const panel = page.locator('#address-panel');
  if (!(await panel.evaluate(node => (node as HTMLDetailsElement).open))) {
    await panel.locator('summary').click();
  }
}

export async function openTokenSettings(page: Page) {
  const settings = page.locator('#network-settings');
  if (!(await settings.evaluate(node => (node as HTMLDetailsElement).open))) {
    await settings.locator(':scope > summary').click();
  }
  const tokens = settings.locator('.token-settings');
  if (!(await tokens.evaluate(node => (node as HTMLDetailsElement).open))) {
    await tokens.locator('summary').click();
  }
}
