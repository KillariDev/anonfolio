import { expect, test } from '@playwright/test';

async function colors(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.documentElement).backgroundColor,
    chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  }));
}

test.describe('theme toggle', () => {
  test.use({ colorScheme: 'light' });
  test('defaults to dark regardless of the system preference, and the light choice persists', async ({ page }) => {
    test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL);
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Switch to light theme', exact: true });
    await expect(toggle).toBeVisible();
    const dark = await colors(page);
    expect(dark.theme).toBe('dark');
    expect(dark.scheme).toBe('dark');
    expect(dark.background).toBe('rgb(15, 18, 17)');
    expect(dark.chrome).toBe('#0f1211');
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Switch to dark theme', exact: true })).toBeVisible();
    const light = await colors(page);
    expect(light.theme).toBe('light');
    expect(light.scheme).toBe('light');
    expect(light.background).toBe('rgb(245, 247, 246)');
    expect(light.chrome).toBe('#f5f7f6');
    expect(await page.evaluate(() => localStorage.getItem('anonfolio.theme.v1'))).toBe('light');
    await page.reload();
    expect((await colors(page)).theme).toBe('light');
    await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
    await page.reload();
    expect((await colors(page)).theme).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('anonfolio.theme.v1'))).toBe('dark');
  });
});
