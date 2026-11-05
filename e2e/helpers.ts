import type { Page } from '@playwright/test';

export async function openAddressForm(page: Page) {
  const panel = page.locator('#address-panel');
  if (!(await panel.evaluate(node => (node as HTMLDetailsElement).open))) {
    await panel.locator('summary').click();
  }
}
