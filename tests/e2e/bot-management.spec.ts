import { expect, test, type Page } from '@playwright/test'
import { authenticate, mockHermesApi } from './fixtures'

async function setup(page: Page) {
  await authenticate(page, undefined, 'research')
  const api = await mockHermesApi(page)
  await page.route(url => url.pathname === '/api/hermes/write-gate/pending', route => route.fulfill({ json: { supported: true, records: [] } }))
  const managementRequests: Array<{ path: string; profile: string | null; assignee: string | null }> = []
  await page.route(url => ['/api/hermes/skills', '/api/hermes/jobs'].includes(url.pathname) || url.pathname.startsWith('/api/hermes/kanban'), async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    managementRequests.push({ path, profile: url.searchParams.get('profile') || request.headers()['x-hermes-profile'] || null, assignee: url.searchParams.get('assignee') })
    if (path === '/api/hermes/skills') return route.fulfill({ json: { categories: [], archived: [] } })
    if (path === '/api/hermes/jobs') return route.fulfill({ json: { jobs: [] } })
    if (path === '/api/hermes/kanban/boards') return route.fulfill({ json: { boards: [{ slug: 'default', name: 'Default', description: '', archived: false, counts: {}, total: 0 }] } })
    if (path === '/api/hermes/kanban/capabilities') return route.fulfill({ json: { capabilities: { source: 'hermes-cli', supports: {}, missing: [] } } })
    if (path === '/api/hermes/kanban/stats') return route.fulfill({ json: { stats: { by_status: {}, by_assignee: {}, total: 0 } } })
    if (path === '/api/hermes/kanban/assignees') return route.fulfill({ json: { assignees: [] } })
    if (path === '/api/hermes/kanban') return route.fulfill({ json: { tasks: [] } })
    return route.fallback()
  })
  return { ...api, managementRequests }
}

for (const { route, label, view, endpoint } of [
  { route: 'skills', label: 'Skills', view: '.skills-view', endpoint: '/api/hermes/skills' },
  { route: 'jobs', label: 'Scheduled Jobs', view: '.jobs-view', endpoint: '/api/hermes/jobs' },
  { route: 'kanban', label: 'Shared board', view: '.kanban-view', endpoint: '/api/hermes/kanban' },
]) {
  test(`opens ${route} for the current Bot, honors explicit links, and returns to that Bot`, async ({ page }) => {
    const api = await setup(page)
    await page.goto('/#/hermes/chat?profile=research')
    await expect(page.locator('.bot-header-identity')).toContainText('research')
    await page.getByRole('button', { name: 'Studio tools', exact: true }).click()
    await page.getByText(label, { exact: true }).click()
    await expect(page.locator(view)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/hermes/${route}\\?[^#]*profile=research`))
    await expect.poll(() => api.managementRequests.filter(request => request.path === endpoint).length).toBeGreaterThan(0)
    expect(api.managementRequests.filter(request => request.path === endpoint).every(request => request.profile === 'research')).toBe(true)
    if (route === 'kanban') expect(api.managementRequests.filter(request => request.path === endpoint).every(request => request.assignee === null)).toBe(true)

    // A copied link must override the other Profile already stored in this tab.
    api.managementRequests.length = 0
    await page.goto(`/#/hermes/${route}?profile=default`)
    await expect(page.locator(view)).toBeVisible()
    await expect.poll(() => api.managementRequests.filter(request => request.path === endpoint).length).toBeGreaterThan(0)
    expect(api.managementRequests.filter(request => request.path === endpoint).every(request => request.profile === 'default')).toBe(true)
    await page.locator('.hermes-config-return').click()
    await expect(page).toHaveURL(/\/hermes\/chat\?profile=default/)
    await expect(page.locator('.bot-row__select[aria-current="page"]')).toContainText('default')
    expect(api.unexpectedRequests).toEqual([])
  })
}

test('discovers a newly created local Bot without moving the current conversation or clearing its draft', async ({ page }) => {
  await setup(page)
  const profiles = [
    { name: 'default', active: false, model: 'test-model' },
    { name: 'research', active: true, model: 'test-model' },
  ]
  await page.route(url => url.pathname === '/api/hermes/profiles', route => route.fulfill({ json: { profiles } }))
  await page.goto('/#/hermes/chat?profile=research')
  const input = page.locator('.new-chat-page textarea').first()
  await input.fill('Keep this research draft')
  const currentUrl = page.url()
  profiles.push({ name: 'new-local-bot', active: false, model: 'test-model' })
  await page.getByRole('button', { name: 'Studio tools', exact: true }).click()
  await page.getByText('Refresh local Bots', { exact: true }).click()
  await expect(page.locator('.bot-row__select').filter({ hasText: 'new-local-bot' })).toBeVisible()
  expect(page.url()).toBe(currentUrl)
  await expect(page.locator('.bot-row__select[aria-current="page"]')).toContainText('research')
  await expect(input).toHaveValue('Keep this research draft')
})
