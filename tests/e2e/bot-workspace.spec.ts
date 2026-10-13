import { expect, test, type Page } from '@playwright/test'
import { authenticate, mockHermesApi } from './fixtures'

async function setupBots(page: Page) {
  await authenticate(page, undefined, 'research')
  const { requests } = await mockHermesApi(page)
  const profiles = [
    { name: 'default', active: false, model: 'test-model', alias: '', displayName: '每日助手', description: '整理日常与计划', avatar: null as any },
    { name: 'research', active: true, model: 'test-model', alias: '', displayName: '研研', description: '把问题研究清楚', avatar: null as any },
  ]
  const mutations: Array<{ path: string; method: string; body: any }> = []
  await page.route('**/api/hermes/profiles**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const body = request.postDataJSON()
    if (method !== 'GET') mutations.push({ path, method, body })
    if (path === '/api/hermes/profiles' && method === 'GET') return route.fulfill({ json: { profiles } })
    if (path === '/api/hermes/profiles' && method === 'POST') {
      const profile = { name: 'bot-test-created', active: false, model: body.sourceConnection?.model || '', alias: '', displayName: body.displayName, description: body.description, avatar: null }
      profiles.push(profile)
      return route.fulfill({ json: { success: true, name: profile.name, profile } })
    }
    const match = path.match(/^\/api\/hermes\/profiles\/([^/]+)\/(identity|avatar)$/)
    if (match) {
      const profile = profiles.find(item => item.name === decodeURIComponent(match[1]))!
      if (match[2] === 'identity') {
        Object.assign(profile, body)
        return route.fulfill({ json: { identity: { displayName: profile.displayName, description: profile.description, updatedAt: Date.now() } } })
      }
      profile.avatar = method === 'DELETE' ? null : { ...body, updatedAt: Date.now() }
      return route.fulfill({ json: { success: true, avatar: profile.avatar } })
    }
    return route.fallback()
  })
  return { profiles, mutations, requests }
}

test('switches Bots in place, scopes drafts and keeps independent sidebar collapse controls', async ({ page }) => {
  const { mutations } = await setupBots(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/hermes/chat?workspace=bots')
  await expect(page.locator('.bot-sidebar')).toBeVisible()
  await expect(page.locator('.bot-header-identity')).toContainText('研研')
  await expect(page.locator('.new-chat-page')).toBeVisible()
  await expect(page.locator('.agent-cards')).toHaveCount(0)
  const composer = page.locator('.new-chat-page textarea').first()
  await composer.fill('仅属于研研的草稿')
  await page.evaluate(() => { (window as any).__botNoReload = 'retained' })
  await page.locator('.bot-row__select').filter({ hasText: '每日助手' }).click()
  await expect(page.locator('.bot-header-identity')).toContainText('每日助手')
  await expect(composer).toHaveValue('')
  await composer.fill('每日助手的草稿')
  await page.locator('.bot-row__select').filter({ hasText: '研研' }).click()
  await expect(page.locator('.bot-header-identity')).toContainText('研研')
  await expect(composer).toHaveValue('仅属于研研的草稿')
  expect(await page.evaluate(() => (window as any).__botNoReload)).toBe('retained')
  expect(mutations.some(item => item.path.endsWith('/active'))).toBe(false)
  await page.getByRole('button', { name: 'Collapse Bot sidebar' }).click()
  await expect(page.locator('.bot-sidebar')).toHaveCSS('width', '72px')
  await page.locator('.header-sidebar-toggle').click()
  await expect(page.locator('.session-list')).toHaveCSS('width', '0px')
  await expect(page.locator('.bot-sidebar')).toBeVisible()
  await page.getByRole('button', { name: 'Studio tools' }).click()
  await expect(page.getByText('Ekko & coding agents', { exact: true })).toBeVisible()
})

test('edits Chinese identity and avatar, cancels preview, and restores avatar without clearing identity', async ({ page }) => {
  const { profiles, mutations } = await setupBots(page)
  await page.goto('/#/hermes/chat?workspace=bots')
  await page.locator('.bot-header-identity').click()
  await page.getByLabel('Display name', { exact: true }).fill('研究搭档')
  await page.getByLabel('Introduction', { exact: true }).fill('阅读、整理与验证')
  const avatar = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64')
  await page.locator('.bot-identity input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: avatar })
  await expect(page.locator('.bot-identity .profile-avatar-image')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(mutations).toHaveLength(0)
  await expect(page.locator('.bot-header-identity')).toContainText('研研')
  await page.locator('.bot-header-identity').click()
  await page.getByLabel('Display name', { exact: true }).fill('研究搭档')
  await page.getByLabel('Introduction', { exact: true }).fill('阅读、整理与验证')
  await page.locator('.bot-identity input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: avatar })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.bot-header-identity')).toContainText('研究搭档')
  await page.reload()
  await expect(page.locator('.bot-header-identity')).toContainText('研究搭档')
  await expect(page.locator('.bot-header-identity .profile-avatar-image')).toBeVisible()
  await page.locator('.bot-header-identity').click()
  await page.getByRole('button', { name: 'Restore default', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.bot-header-identity .profile-avatar-image')).toHaveCount(0)
  expect(profiles.find(profile => profile.name === 'research')).toMatchObject({ displayName: '研究搭档', description: '阅读、整理与验证', avatar: null })
})

test('creates a blank Bot with an explicit model source and works in the mobile navigation drawer', async ({ page }) => {
  const { mutations } = await setupBots(page)
  await page.goto('/#/hermes/chat?workspace=bots')
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByLabel('Display name', { exact: true }).fill('写作搭档')
  await page.getByLabel('Introduction', { exact: true }).fill('帮我写得更清楚')
  await expect(page.locator('.bot-identity')).toContainText('test-model')
  await page.locator('.drawer-actions').getByRole('button', { name: 'New Bot', exact: true }).click()
  await expect(page.locator('.bot-header-identity')).toContainText('写作搭档')
  const creation = mutations.find(item => item.path === '/api/hermes/profiles' && item.method === 'POST')!
  expect(creation.body).toEqual({ displayName: '写作搭档', description: '帮我写得更清楚', sourceConnection: { profile: 'research', provider: 'test-provider', model: 'test-model' } })
  await page.setViewportSize({ width: 390, height: 800 })
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await expect(page.locator('.studio-mobile-drawer .bot-sidebar')).toBeVisible()
  await expect(page.locator('.studio-mobile-drawer .session-list')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
