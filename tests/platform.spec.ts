import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { Dataset } from '../src/types';

const dataset: Dataset = JSON.parse(fs.readFileSync('public/data/trees.json', 'utf8'));

test('real point cloud loads, resources stay same-origin, desktop/mobile have no horizontal overflow', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await expect(page.locator('#viewer')).toHaveAttribute('data-loaded-tree', '1-001');
  await expect(page.locator('#viewer canvas')).toBeVisible();
  await expect(page.locator('.height-metric strong')).toContainText('8.71');
  await expect(page.locator('#viewer')).toHaveAttribute('data-loaded-quality', testInfo.project.name === 'mobile' ? 'lite' : 'high');
  expect(requests.filter((url) => url.includes('/models/'))).toHaveLength(1);
  expect(requests.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  // Catch a washed-out cloud caused by mishandling normalized PLY colors.
  const canvasImage = PNG.sync.read(await page.locator('#viewer canvas').screenshot());
  let coloredPixels = 0;
  for (let i = 0; i < canvasImage.data.length; i += 4) {
    const r = canvasImage.data[i], g = canvasImage.data[i + 1], b = canvasImage.data[i + 2];
    if (r < 170 && g < 170 && b < 170 && Math.max(r, g, b) - Math.min(r, g, b) > 15) coloredPixels++;
  }
  expect(coloredPixels).toBeGreaterThan(500);
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-browse.png`, fullPage: true });
});

test('both source formats, largest/smallest trees, colors, quality, point size and rotation work', async ({ page }) => {
  await page.goto('/?tree=1-022');
  await expect(page.locator('#viewer')).toHaveAttribute('data-loaded-tree', '1-022');
  await page.locator('[data-color="height"]').click();
  await expect(page.locator('[data-color="height"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="rotate"]').click();
  await expect(page.locator('[data-action="rotate"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#point-size').fill('4');
  await page.locator('#quality').selectOption('lite');
  await expect(page.locator('#viewer')).toHaveAttribute('data-loaded-quality', 'lite');
  await page.locator('[data-action="reset-view"]').click();
  for (const id of ['1-009', '2-001', '2-030']) {
    await page.locator(`.tree-row[data-tree="${id}"]`).click();
    await expect(page.locator('#viewer')).toHaveAttribute('data-loaded-tree', id);
    await expect(page.locator('#tree-title')).toHaveText(id);
  }
  await page.locator('#quality').selectOption('high');
  await expect(page.locator('#viewer')).toHaveAttribute('data-loaded-quality', 'high');
  await expect(page.locator('.viewer-cloud-badge')).toContainText('26,483');
});

test('authoritative diameter, missing values, filtering and no-result state', async ({ page }) => {
  await page.goto('/?tree=1-002');
  await expect(page.locator('.dbh-metric dd')).toContainText('79.3');
  await page.locator('.tree-row[data-tree="1-003"]').click();
  await expect(page.locator('.dbh-metric dd')).toHaveText('暂无可靠结果');
  await page.locator('#reliability-filter').selectOption('missing');
  await expect(page.locator('#filter-count')).toHaveText('42');
  await page.locator('#reliability-filter').selectOption('reliable');
  await expect(page.locator('#filter-count')).toHaveText('26');
  await expect(page.locator('#selection-notice')).toBeVisible();
  await page.locator('#search').fill('not-a-tree');
  await expect(page.locator('#filter-count')).toHaveText('0');
  await expect(page.locator('.empty-directory')).toBeVisible();
  await page.locator('#clear-filters').click();
  await expect(page.locator('#filter-count')).toHaveText('68');
});

test('table sorts nulls last and filtered CSV preserves meter units and missing values', async ({ page }, testInfo) => {
  await page.goto('/?view=table');
  await expect(page.locator('tbody tr')).toHaveCount(68);
  await page.locator('[data-sort="dbh"]').click();
  await expect(page.locator('tbody tr').last()).toContainText('暂无可靠结果');
  await page.locator('[data-sort="dbh"]').click();
  await expect(page.locator('tbody tr').last()).toContainText('暂无可靠结果');
  const expectedAverage = dataset.trees.filter((t) => t.dbh !== null).reduce((sum, t) => sum + t.dbh! * 100, 0) / 26;
  await expect(page.locator('.table-summary')).toContainText(expectedAverage.toFixed(1));
  await page.locator('#search').fill('1-002');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const download = await downloadEvent;
  const output = testInfo.outputPath('filtered.csv');
  await download.saveAs(output);
  const csv = fs.readFileSync(output, 'utf8');
  expect(csv).toContain('DBH_Avg(m)');
  expect(csv).toContain(',0.793,True,');
  expect(csv).not.toContain('0.874');
  expect(csv.trim().split(/\r?\n/)).toHaveLength(2);
  await page.locator('#clear-filters').click();
  await page.locator('#reliability-filter').selectOption('missing');
  await expect(page.locator('tbody tr')).toHaveCount(42);
  await expect(page.locator('.table-summary')).toContainText('平均可信胸径 —');
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-table.png`, fullPage: true });
});

test('group maps select trees using pointer/keyboard and link to the 3D view', async ({ page }, testInfo) => {
  await page.goto('/?view=map&tree=1-001');
  await expect(page.locator('.map-point')).toHaveCount(33);
  await page.locator('.map-point[data-tree="1-003"]').press('Enter');
  await expect(page.locator('.profile-id')).toHaveText('1-003');
  await expect(page.locator('.dbh-metric dd')).toHaveText('暂无可靠结果');
  await page.locator('[data-map-group="2"]').click();
  await expect(page.locator('.map-point')).toHaveCount(35);
  await expect(page.locator('.profile-id')).toHaveText('2-001');
  await page.locator('.map-point[data-tree="2-030"]').click();
  await expect(page.locator('.profile-id')).toHaveText('2-030');
  await expect(page).toHaveURL(/tree=2-030/);
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-map.png`, fullPage: true });
  await page.locator('[data-action="open-browse"]').click();
  await expect(page.locator('#viewer')).toHaveAttribute('data-loaded-tree', '2-030');
});

test('point cloud request failure falls back to real image and retry recovers', async ({ page }) => {
  await page.route('**/models/1-001-*.ply', (route) => route.fulfill({ status: 503, body: 'offline' }));
  await page.goto('/');
  await expect(page.locator('.viewer-status')).toContainText('点云加载失败');
  await expect(page.locator('.viewer-fallback')).toBeVisible();
  await expect(page.locator('.height-metric strong')).toContainText('8.71');
  await page.unroute('**/models/1-001-*.ply');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.locator('#viewer')).toHaveAttribute('data-loaded-tree', '1-001');
});

test('no WebGL still exposes image, measurements and parameter table', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.includes('webgl')) return null;
      return getContext.apply(this, [type, ...args] as never);
    } as typeof getContext;
  });
  await page.goto('/?tree=1-003');
  await expect(page.locator('.viewer-status')).toContainText('切换为点云图片');
  await expect(page.locator('.viewer-fallback')).toBeVisible();
  await expect(page.locator('.dbh-metric dd')).toHaveText('暂无可靠结果');
  await page.locator('[data-view="table"]').click();
  await expect(page.locator('tbody tr')).toHaveCount(68);
});

test('missing dataset shows a useful recovery screen', async ({ page }) => {
  await page.route('**/data/trees.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '树木档案暂时无法载入' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
});
