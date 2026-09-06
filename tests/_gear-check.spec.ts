import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

test('anon gear visibility flag ON', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  
  const gearCount = await page.locator('svg.lucide-settings').count();
  console.log('Gear SVG elements (anon, flag ON):', gearCount);
  
  await page.screenshot({ path: 'docs/research/ui-after/35-gear-anon.png', fullPage: false });
  
  // Gear should NOT be visible for anon under flag ON
  expect(gearCount).toBe(0);
});
