import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/design.html')
})
const light = (page: import('@playwright/test').Page) => page.getByTestId('light')

test('gallery renders in both themes', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Components (light)' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Components (dark)' })).toBeVisible()
  const bg = (id: string) =>
    page.getByTestId(id).evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await bg('light')).not.toBe(await bg('dark'))
})

test('dialog traps focus, closes on Esc and returns focus', async ({ page }) => {
  const opener = light(page).getByRole('button', { name: 'Open dialog' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Delete project' })
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    // Focus may pass through browser chrome (body) but never reaches the page behind.
    expect(
      await dialog.evaluate(
        (d) => d.contains(document.activeElement) || document.activeElement === document.body,
      ),
    ).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})

test('menu opens with Enter, arrows move, Esc closes', async ({ page }) => {
  const trigger = light(page).getByRole('button', { name: 'Actions' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu', { name: 'Actions' }).first()
  await expect(menu).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Star' })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'Delete project' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()
})

test('toast is announced through an aria-live region', async ({ page }) => {
  const region = light(page).getByRole('status')
  await expect(region).toHaveAttribute('aria-live', 'polite')
  await expect(region).toBeEmpty()
  await light(page).getByRole('button', { name: 'Show toast' }).click()
  await expect(region).toContainText('Plan draft rejected.')
})

test('checkbox toggles with Space', async ({ page }) => {
  const box = light(page).getByRole('checkbox', { name: 'Unchecked' })
  await box.focus()
  await page.keyboard.press('Space')
  await expect(box).toBeChecked()
  await page.keyboard.press('Space')
  await expect(box).not.toBeChecked()
})

test('every control shows a focus ring', async ({ page }) => {
  const seen = new Set<string>()
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      if (!el || el === document.body || !el.closest('[data-testid=light]')) return null
      const cs = getComputedStyle(el)
      return { tag: el.outerHTML.slice(0, 60), style: cs.outlineStyle, width: cs.outlineWidth }
    })
    if (!s) continue
    expect(s.style, s.tag).toBe('solid')
    expect(s.width, s.tag).toBe('2px')
    seen.add(`${i}`)
  }
  expect(seen.size).toBeGreaterThan(12)
})

test('tabs in the dark panel move with arrows without touching the light panel', async ({
  page,
}) => {
  const dark = page.getByTestId('dark')
  await dark.getByRole('tab', { name: 'Plan' }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(dark.getByRole('tab', { name: 'Tasks' })).toBeFocused()
  await expect(dark.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('light').getByRole('tab', { name: 'Plan' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('dialog onClose fires once from the close button', async ({ page }) => {
  const p = page.getByTestId('light')
  await p.getByRole('button', { name: 'Open dialog' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(p.getByTestId('closes')).toHaveText('1')
})

test('menu closes on Tab and on scroll', async ({ page }) => {
  const p = page.getByTestId('light')
  const trigger = p.getByRole('button', { name: 'Actions' })
  const menu = page.getByRole('menu', { name: 'Actions' }).first()
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Tab')
  await expect(menu).toBeHidden()
  await trigger.click()
  await expect(menu).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.waitForTimeout(50) // let the effect attach its scroll listener
  await page.evaluate(() => window.scrollTo(0, window.scrollY > 100 ? 0 : 300))
  await expect(menu).toBeHidden()
})

test('focus ring visible in dark panel and no page-level horizontal overflow at 1440', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.goto('/design.html')
  await page.getByTestId('dark').getByRole('button', { name: 'Primary' }).focus()
  await page.keyboard.press('Tab')
  const s = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement as Element)
    return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor]
  })
  expect(s[0]).toBe('solid')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('tabs: roving tabindex, arrows move selection; disabled button not focusable', async ({
  page,
}) => {
  await page.goto('/design.html')
  const p = page.getByTestId('light')
  await expect(p.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('tabindex', '-1')
  await p.getByRole('tab', { name: 'Plan' }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(p.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true')
  await expect(p.getByRole('tab', { name: 'Tasks' })).toBeFocused()
  await expect(p.getByRole('button', { name: 'Disabled' })).toBeDisabled()
})
