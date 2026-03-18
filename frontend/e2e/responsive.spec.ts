import { test, expect, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const SCREENSHOT_DIR = 'e2e/screenshots'
const AUTH_FILE = path.join(__dirname, '.auth', 'credentials.json')

/** Read saved credentials from auth setup */
function getCredentials(): { token: string; user: Record<string, unknown> } {
  const data = fs.readFileSync(AUTH_FILE, 'utf-8')
  return JSON.parse(data)
}

/** Inject auth token into localStorage then navigate to the target page */
async function navigateAuthenticated(page: Page, targetPath: string) {
  const creds = getCredentials()
  // First go to any page to get a browsing context
  await page.goto('/login')
  await page.waitForLoadState('domcontentloaded')
  // Inject auth into localStorage (key must be 'auth_token' to match AuthProvider)
  await page.evaluate(({ token }) => {
    localStorage.setItem('auth_token', token)
  }, creds)
  // Now navigate to the actual target
  await page.goto(targetPath)
  await page.waitForLoadState('domcontentloaded')
}

// ─── Login Page ───────────────────────────────────────────────────────────

test.describe('Login Page', () => {
  test('renders correctly at all viewport sizes', async ({ page }, testInfo) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: /coordination matrix/i })).toBeVisible()

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/login-${testInfo.project.name}.png`,
      fullPage: true,
    })

    // Verify key elements are visible
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()

    // Check the form doesn't overflow the viewport
    const formCard = page.locator('.bg-card').first()
    const box = await formCard.boundingBox()
    const viewport = page.viewportSize()!
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  })
})

// ─── Dashboard ────────────────────────────────────────────────────────────

test.describe('Dashboard', () => {
  test('layout and header render correctly', async ({ page }, testInfo) => {
    await navigateAuthenticated(page, '/')
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/dashboard-${testInfo.project.name}.png`,
      fullPage: true,
    })

    // No horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewport = page.viewportSize()!
    expect(bodyWidth).toBeLessThanOrEqual(viewport.width + 5)
  })

  test('kanban board is scrollable on small screens', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'desktop') {
      test.skip()
    }

    await navigateAuthenticated(page, '/')
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })

    const scrollWrapper = page.locator('.overflow-x-auto').first()
    if (await scrollWrapper.isVisible().catch(() => false)) {
      const wrapper = await scrollWrapper.boundingBox()
      const viewport = page.viewportSize()!
      expect(wrapper!.width).toBeLessThanOrEqual(viewport.width + 1)

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/dashboard-kanban-${testInfo.project.name}.png`,
      })
    }
  })
})

// ─── Sidebar ──────────────────────────────────────────────────────────────

test.describe('Sidebar', () => {
  test('mobile: hamburger menu opens sidebar drawer', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip()
    }

    await navigateAuthenticated(page, '/')
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/sidebar-closed-mobile.png`,
    })

    // Click hamburger button (first button on the page in mobile header)
    const hamburger = page.getByRole('button').first()
    await hamburger.click()
    await page.waitForTimeout(500)

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/sidebar-open-mobile.png`,
    })

    // Sidebar navigation links should be visible
    const dashboardLink = page.getByRole('link', { name: /dashboard/i })
    await expect(dashboardLink).toBeVisible()
  })

  test('tablet: sidebar starts collapsed and can be toggled', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'tablet') {
      test.skip()
    }

    await navigateAuthenticated(page, '/')
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })

    // Clear any saved preference so we get default behavior
    await page.evaluate(() => localStorage.removeItem('sidebar.collapsed'))
    await page.reload()
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })

    const sidebar = page.locator('[data-testid="sidebar"]')
    await expect(sidebar).toBeVisible()

    // Sidebar should start collapsed on tablet (width <= 100px)
    const collapsedBox = await sidebar.boundingBox()
    expect(collapsedBox!.width).toBeLessThan(100)

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/sidebar-tablet-collapsed.png`,
    })

    // Expand sidebar via toggle button
    const expandButton = page.getByRole('button', { name: /expand sidebar/i })
    await expect(expandButton).toBeVisible()
    await expandButton.click()
    await page.waitForTimeout(300) // animation

    const expandedBox = await sidebar.boundingBox()
    expect(expandedBox!.width).toBeGreaterThan(200)

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/sidebar-tablet-expanded.png`,
    })

    // Saved searches section should now be visible
    await expect(page.getByText('Saved Searches')).toBeVisible()

    // Collapse back
    const collapseButton = page.getByRole('button', { name: /collapse sidebar/i })
    await collapseButton.click()
    await page.waitForTimeout(300)

    const reCollapsedBox = await sidebar.boundingBox()
    expect(reCollapsedBox!.width).toBeLessThan(100)
  })

  test('tablet: saved searches accessible via bookmark icon', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'tablet') {
      test.skip()
    }

    await navigateAuthenticated(page, '/')
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })

    // Clear preference to start collapsed
    await page.evaluate(() => localStorage.removeItem('sidebar.collapsed'))
    await page.reload()
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })

    // Saved Searches text should not be visible when collapsed
    await expect(page.getByText('Saved Searches')).not.toBeVisible()

    // Bookmark icon should be visible and clickable to expand
    const bookmarkButton = page.getByRole('button', { name: /saved searches/i })
    await expect(bookmarkButton).toBeVisible()
    await bookmarkButton.click()
    await page.waitForTimeout(300)

    // Sidebar should now be expanded with saved searches visible
    await expect(page.getByText('Saved Searches')).toBeVisible()
  })

  test('desktop: sidebar shows full width and can be collapsed', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'desktop') {
      test.skip()
    }

    await navigateAuthenticated(page, '/')
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })

    // Clear preference to get default behavior
    await page.evaluate(() => localStorage.removeItem('sidebar.collapsed'))
    await page.reload()
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })

    const sidebar = page.locator('[data-testid="sidebar"]')

    // Desktop should start expanded
    const expandedBox = await sidebar.boundingBox()
    expect(expandedBox!.width).toBeGreaterThan(200)

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/sidebar-desktop.png`,
    })

    // Full sidebar with text labels
    const dashboardLink = page.getByRole('link', { name: /dashboard/i })
    await expect(dashboardLink).toBeVisible()

    // Collapse via toggle
    const collapseButton = page.getByRole('button', { name: /collapse sidebar/i })
    await expect(collapseButton).toBeVisible()
    await collapseButton.click()
    await page.waitForTimeout(300)

    const collapsedBox = await sidebar.boundingBox()
    expect(collapsedBox!.width).toBeLessThan(100)

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/sidebar-desktop-collapsed.png`,
    })

    // Expand again
    const expandButton = page.getByRole('button', { name: /expand sidebar/i })
    await expandButton.click()
    await page.waitForTimeout(300)

    const reExpandedBox = await sidebar.boundingBox()
    expect(reExpandedBox!.width).toBeGreaterThan(200)
  })
})

// ─── Tasks Page ───────────────────────────────────────────────────────────

test.describe('Tasks Page', () => {
  test('header and toolbar render correctly', async ({ page }, testInfo) => {
    await navigateAuthenticated(page, '/tasks')
    await expect(page.getByRole('heading', { name: /tasks/i })).toBeVisible({ timeout: 15000 })

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/tasks-${testInfo.project.name}.png`,
      fullPage: true,
    })

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewport = page.viewportSize()!
    expect(bodyWidth).toBeLessThanOrEqual(viewport.width + 5)
  })

  test('toolbar buttons are icon-only on mobile', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip()
    }

    await navigateAuthenticated(page, '/tasks')
    await expect(page.getByRole('heading', { name: /tasks/i })).toBeVisible({ timeout: 15000 })

    const hiddenLabels = page.locator('.hidden.sm\\:inline')
    const count = await hiddenLabels.count()
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 3); i++) {
        await expect(hiddenLabels.nth(i)).not.toBeVisible()
      }
    }
  })

  test('data table scrolls horizontally on mobile', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip()
    }

    await navigateAuthenticated(page, '/tasks')
    await expect(page.getByRole('heading', { name: /tasks/i })).toBeVisible({ timeout: 15000 })

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/tasks-table-mobile.png`,
    })

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewport = page.viewportSize()!
    expect(bodyWidth).toBeLessThanOrEqual(viewport.width + 5)
  })
})

// ─── Secondary Pages ──────────────────────────────────────────────────────

const secondaryPages = [
  { path: '/workflows', name: 'workflows' },
  { path: '/workflow-runs', name: 'workflow-runs' },
  { path: '/users', name: 'users' },
  { path: '/projects', name: 'projects' },
  { path: '/documents', name: 'documents' },
  { path: '/activity', name: 'activity' },
  { path: '/conversations', name: 'conversations' },
  { path: '/requests', name: 'requests' },
]

test.describe('Secondary Pages', () => {
  for (const { path, name } of secondaryPages) {
    test(`${name}: no horizontal overflow`, async ({ page }, testInfo) => {
      await navigateAuthenticated(page, path)
      await page.waitForTimeout(1000)

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${name}-${testInfo.project.name}.png`,
        fullPage: true,
      })

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      const viewport = page.viewportSize()!
      expect(bodyWidth).toBeLessThanOrEqual(viewport.width + 5)
    })
  }
})

// ─── No Overflow Check ───────────────────────────────────────────────────

test.describe('Global overflow check', () => {
  test('no page has horizontal overflow', async ({ page }, testInfo) => {
    const pages = ['/', '/workflows', '/users', '/projects', '/settings']

    for (const pagePath of pages) {
      await navigateAuthenticated(page, pagePath)
      await page.waitForTimeout(500)

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      const viewport = page.viewportSize()!

      if (bodyWidth > viewport.width + 5) {
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/overflow-${pagePath.replace(/\//g, '-')}-${testInfo.project.name}.png`,
          fullPage: true,
        })
      }

      expect(
        bodyWidth,
        `Page ${pagePath} has horizontal overflow (body: ${bodyWidth}px, viewport: ${viewport.width}px)`
      ).toBeLessThanOrEqual(viewport.width + 5)
    }
  })
})
