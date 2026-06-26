import { test, expect, type Page } from '@playwright/test'

// Visual-regression coverage for /editor and /preview. The animated stage is frozen on a
// single seeked frame (?test=1) so the WebGL render is deterministic — these catch
// the layout/render regressions we kept hitting (filmstrip occlusion, side cropping,
// character position jump, distortion across framings).

// Wait for the stage's frozen frame to be decoded AND drawn (Stage sets data-ready).
async function stageReady(page: Page) {
  await expect(page.locator('canvas')).toHaveAttribute('data-ready', '1', { timeout: 20_000 })
  await page.waitForTimeout(200) // a couple more RAFs so the frame is fully painted
}

test('editor grid', async ({ page }) => {
  await page.goto('/editor')
  await page.getByText(/\d+ items/).waitFor({ timeout: 20_000 })
  await page.waitForLoadState('networkidle') // thumbnails + framing overlays settled
  await expect(page).toHaveScreenshot('editor.png', { fullPage: true })
})

test('preview — idle (regular framing)', async ({ page }) => {
  await page.goto('/preview?test=1&clip=monet-idle-1&t=0.4')
  await stageReady(page)
  await expect(page).toHaveScreenshot('preview-idle.png')
})

test('preview — wide framing fills width, no side crop', async ({ page }) => {
  await page.goto('/preview?test=1&clip=monet-prepare-to-throw-wide-1&t=0.4')
  await stageReady(page)
  await expect(page).toHaveScreenshot('preview-wide.png')
})

test('preview — zoomed (viewport-rect, character undistorted)', async ({ page }) => {
  await page.goto('/preview?test=1&clip=monet-idle-1&t=0.4&zoom=1.6')
  await stageReady(page)
  await expect(page).toHaveScreenshot('preview-zoom.png')
})
