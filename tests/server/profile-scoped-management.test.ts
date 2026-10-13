import Koa from 'koa'
import { bodyParser } from '@koa/bodyparser'
import { once } from 'events'
import type { Server } from 'http'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const access = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('../../packages/server/src/modules/studio/repositories/users-store', () => ({ userCanAccessProfile: access.check }))
const profileConfig = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }))
vi.mock('../../packages/server/src/modules/studio/public/profile-config', async original => ({
  ...await original<typeof import('../../packages/server/src/modules/studio/public/profile-config')>(),
  readConfigYamlForProfile: profileConfig.read,
  updateConfigYamlForProfile: profileConfig.update,
}))

import { resolveUserProfile } from '../../packages/server/src/modules/studio/middleware/auth'
import { jobRoutes } from '../../packages/server/src/modules/hermes/routes/jobs'
import { cronHistoryRoutes } from '../../packages/server/src/modules/hermes/routes/cron-history'
import { skillRoutes } from '../../packages/server/src/modules/hermes/routes/skills'
import { skillBundleRoutes } from '../../packages/server/src/modules/hermes/routes/skill-bundles'
import { guardExplicitProfile } from '../../packages/server/src/modules/hermes/controllers/profile-scope'
import { getProfileDir } from '../../packages/server/src/modules/hermes/services/profiles/profile'
import { ProfileLifecycleError } from '../../packages/server/src/modules/hermes/services/profiles/lifecycle'

const endpoints = [
  ['GET', '/api/hermes/jobs'],
  ['GET', '/api/hermes/jobs/delivery-targets'],
  ['GET', '/api/hermes/jobs/shared-id'],
  ['POST', '/api/hermes/jobs'],
  ['PATCH', '/api/hermes/jobs/shared-id'],
  ['DELETE', '/api/hermes/jobs/shared-id'],
  ['POST', '/api/hermes/jobs/shared-id/pause'],
  ['POST', '/api/hermes/jobs/shared-id/resume'],
  ['POST', '/api/hermes/jobs/shared-id/run'],
  ['GET', '/api/cron-history'],
  ['GET', '/api/cron-history/shared-id/run.md'],
  ['GET', '/api/hermes/skills'],
  ['GET', '/api/hermes/skills/usage/stats'],
  ['GET', '/api/hermes/skills/external-dirs'],
  ['PUT', '/api/hermes/skills/external-dirs'],
  ['PUT', '/api/hermes/skills/toggle'],
  ['PUT', '/api/hermes/skills/pin'],
  ['POST', '/api/hermes/skills/import'],
  ['PUT', '/api/hermes/skills/misc/example'],
  ['DELETE', '/api/hermes/skills/misc/example'],
  ['GET', '/api/hermes/skills/misc/example/files'],
  ['GET', '/api/hermes/skills/misc/example/SKILL.md'],
  ['GET', '/api/hermes/bundles'],
  ['POST', '/api/hermes/bundles'],
  ['DELETE', '/api/hermes/bundles/example'],
] as const

describe('explicit Profile scope for cron and Skills management', () => {
  let root: string
  let server: Server
  let origin: string
  const configContent = 'skills:\n  disabled: []\n'
  const skillContent = '# Default-only skill\nMust remain unchanged.\n'

  beforeEach(async () => {
    vi.clearAllMocks()
    access.check.mockReturnValue(false)
    profileConfig.read.mockResolvedValue({})
    root = await mkdtemp(join(tmpdir(), 'hermes-management-scope-'))
    vi.stubEnv('HERMES_HOME', root)
    for (const [profile, title] of [['default', 'Default task'], ['alpha', 'Alpha task']]) {
      const directory = profile === 'default' ? root : join(root, 'profiles', profile)
      await mkdir(join(directory, 'cron'), { recursive: true })
      await writeFile(join(directory, 'cron/jobs.json'), JSON.stringify({ jobs: [{ id: 'shared-id', job_id: 'shared-id', name: title }] }))
    }
    await mkdir(join(root, 'skills/misc/example'), { recursive: true })
    await writeFile(join(root, 'skills/misc/example/SKILL.md'), skillContent)
    await writeFile(join(root, 'config.yaml'), configContent)
    await writeFile(join(root, 'active_profile'), 'default\n')
    const app = new Koa()
    app.use(bodyParser())
    app.use(async (ctx, next) => {
      ctx.state.user = { id: 7, username: 'fixture', role: ctx.get('x-test-user') ? 'user' : 'super_admin' }
      await next()
    })
    app.use(resolveUserProfile)
    for (const router of [jobRoutes, cronHistoryRoutes, skillRoutes, skillBundleRoutes]) app.use(router.routes())
    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  async function request(method: string, path: string, profile?: string, headers: Record<string, string> = {}) {
    return fetch(origin + path, {
      method,
      headers: { 'content-type': 'application/json', ...(profile ? { 'x-hermes-profile': profile } : {}), ...headers },
      ...(['POST', 'PUT', 'PATCH'].includes(method) ? { body: JSON.stringify({ name: 'example', enabled: false, prompt: 'changed' }) } : {}),
    })
  }

  it.each(endpoints)('rejects missing Profile before %s %s can access default data', async (method, path) => {
    const response = await request(method, path, 'deleted-bot')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'profile_not_found' })
    expect(profileConfig.read).not.toHaveBeenCalled()
    expect(profileConfig.update).not.toHaveBeenCalled()
    expect(await readFile(join(root, 'config.yaml'), 'utf8')).toBe(configContent)
    expect(await readFile(join(root, 'skills/misc/example/SKILL.md'), 'utf8')).toBe(skillContent)
  })

  it('keeps default compatibility while rejecting a previously available Bot after deletion', async () => {
    expect(await (await request('GET', '/api/hermes/jobs/shared-id', 'alpha')).json()).toMatchObject({ job: { name: 'Alpha task' } })
    await rm(join(root, 'profiles/alpha'), { recursive: true })
    expect((await request('GET', '/api/hermes/jobs/shared-id', 'alpha')).status).toBe(404)
    expect(await (await request('GET', '/api/hermes/jobs/shared-id')).json()).toMatchObject({ job: { name: 'Default task' } })
    expect(await (await request('GET', '/api/hermes/jobs/shared-id', 'default')).json()).toMatchObject({ job: { name: 'Default task' } })
  })

  it.each(['../outside', 'ALPHA'])('rejects unsafe or remapped IDs: %s', async profile => {
    expect((await request('GET', '/api/hermes/jobs/shared-id', profile)).status).toBe(400)
  })

  it('checks user authorization before revealing whether the Profile exists or is valid', async () => {
    for (const profile of ['alpha', 'deleted-bot', '../outside', 'ALPHA']) {
      const response = await request('GET', '/api/hermes/jobs/shared-id', profile, { 'x-test-user': '1' })
      expect(response.status).toBe(403)
      expect(await response.json()).not.toHaveProperty('code')
      expect(access.check).toHaveBeenCalledWith(7, profile)
    }
    access.check.mockReturnValue(true)
    expect((await request('GET', '/api/hermes/jobs/shared-id', 'deleted-bot', { 'x-test-user': '1' })).status).toBe(404)
  })

  it('applies the guard to query and body Profile scope too', async () => {
    expect((await request('GET', '/api/hermes/skills?profile=deleted-bot')).status).toBe(404)
    const response = await fetch(origin + '/api/hermes/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: 'deleted-bot', prompt: 'changed' }),
    })
    expect(response.status).toBe(404)
  })

  it('rejects a symlinked Profile instead of reading its target', async () => {
    await symlink(root, join(root, 'profiles/alias'), 'dir')
    expect((await request('GET', '/api/hermes/jobs/shared-id', 'alias')).status).toBe(404)
  })

  it('does not remap an existing legacy reserved Profile to default', async () => {
    await mkdir(join(root, 'profiles/test/cron'), { recursive: true })
    await writeFile(join(root, 'profiles/test/cron/jobs.json'), '{"jobs":[{"id":"shared-id","name":"Legacy task"}]}')
    expect(await (await request('GET', '/api/hermes/jobs/shared-id', 'test')).json()).toMatchObject({ job: { name: 'Legacy task' } })
  })

  it('does not serialize controls or leak directory scope across awaited requests', async () => {
    let release!: () => void
    let entered!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const first = { state: { profile: { name: 'alpha' } } } as any
    const running = guardExplicitProfile(first, async () => {
      expect(getProfileDir('alpha')).toBe(join(root, 'profiles/alpha'))
      entered()
      await pending
      expect(() => getProfileDir('alpha')).toThrow(ProfileLifecycleError)
    })
    await started
    try {
      // A second request for the same Bot is usable while the first awaits work.
      expect((await request('GET', '/api/hermes/jobs/shared-id', 'alpha')).status).toBe(200)
      await rm(join(root, 'profiles/alpha'), { recursive: true })
      expect(getProfileDir('alpha')).toBe(root) // Legacy caller outside the request remains unchanged.
      expect((await request('GET', '/api/hermes/jobs/shared-id', 'default')).status).toBe(200)
    } finally {
      release()
      await running
    }
  })
})
