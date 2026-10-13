import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseEnv } from 'node:util'
import YAML from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareBotConnection, validateSourceConnection } from '../../packages/server/src/modules/hermes/services/profiles/bot-connection'
import { createProfileWithoutHermes, existingProfileDirectory } from '../../packages/server/src/modules/hermes/services/profiles/lifecycle'

describe('blank Bot Profile model connections', () => {
  let root: string
  let source: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'studio-bot-connection-'))
    source = join(root, 'profiles', 'research')
    await mkdir(source, { recursive: true })
    await writeFile(join(root, 'active_profile'), 'default\n')
    await writeFile(join(root, '.env'), 'OPENAI_API_KEY=wrong-default-key\n')
    await writeFile(join(source, 'config.yaml'), 'model:\n  provider: openai-api\n  default: gpt-source\n  context_length: 32000\nproviders:\n  openai-api:\n    models:\n      gpt-selected:\n        context_length: 64000\ntools:\n  disabled: [browser]\nplatforms:\n  telegram:\n    enabled: true\n')
    await writeFile(join(source, '.env'), 'OPENAI_API_KEY=source-key\nOPENAI_BASE_URL=https://source.example/v1\nTELEGRAM_BOT_TOKEN=private-platform\nANTHROPIC_API_KEY=other-provider\n')
    await writeFile(join(source, 'SOUL.md'), 'Source personality')
    await mkdir(join(source, 'memories'))
    await writeFile(join(source, 'memories', 'MEMORY.md'), 'Private source memory')
    await mkdir(join(source, 'cron'))
    await writeFile(join(source, 'cron', 'jobs.json'), '[{"id":"private-job"}]')
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('copies only the explicitly chosen connection into an independent blank Profile', async () => {
    const initialize = await prepareBotConnection({ profile: 'research', provider: 'openai-api', model: 'gpt-selected' }, root)
    const result = await createProfileWithoutHermes('new-bot', false, root, initialize)
    expect(YAML.load(await readFile(join(result.path, 'config.yaml'), 'utf8'))).toEqual({
      model: { provider: 'openai-api', default: 'gpt-selected', context_length: 64000 },
      providers: { 'openai-api': { models: { 'gpt-selected': { context_length: 64000 } } } },
    })
    expect(parseEnv(await readFile(join(result.path, '.env'), 'utf8'))).toEqual({ OPENAI_API_KEY: 'source-key', OPENAI_BASE_URL: 'https://source.example/v1' })
    expect((await stat(join(result.path, '.env'))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(result.path, 'SOUL.md'), 'utf8')).not.toContain('Source personality')
    expect(await readdir(join(result.path, 'memories'))).toEqual([])
    expect(await readdir(join(result.path, 'cron'))).toEqual([])
    expect(await readdir(join(result.path, 'sessions'))).toEqual([])
    await writeFile(join(result.path, '.env'), 'OPENAI_API_KEY=changed-target\n')
    expect(await readFile(join(source, '.env'), 'utf8')).toContain('OPENAI_API_KEY=source-key')
    expect(await readFile(join(root, 'active_profile'), 'utf8')).toBe('default\n')
  })

  it('copies the chosen custom provider across both schemas without unrelated connections', async () => {
    await writeFile(join(source, 'config.yaml'), YAML.dump({
      providers: {
        own: { name: 'Own Model', base_url: 'https://own.example/v1', api_key_env: 'OWN_MODEL_KEY', api_mode: 'anthropic_messages', models: { chosen: { context_length: 200000 }, ignored: {} } },
        other: { base_url: 'https://other.example/v1', api_key: 'unrelated-secret' },
      },
    }))
    await writeFile(join(source, '.env'), 'OWN_MODEL_KEY="my key #with spaces"\nUNRELATED_KEY=private\n')
    const initialize = await prepareBotConnection({ profile: 'research', provider: 'custom:own-model', model: 'chosen' }, root)
    const result = await createProfileWithoutHermes('custom-bot', false, root, initialize)
    const config = YAML.load(await readFile(join(result.path, 'config.yaml'), 'utf8')) as any
    expect(config.custom_providers).toEqual([{
      name: 'Own Model', base_url: 'https://own.example/v1', key_env: 'OWN_MODEL_KEY', api_mode: 'anthropic_messages', model: 'chosen', models: { chosen: { context_length: 200000 } },
    }])
    expect(config.providers).toBeUndefined()
    expect(config.model.context_length).toBe(200000)
    expect(parseEnv(await readFile(join(result.path, '.env'), 'utf8'))).toEqual({ OWN_MODEL_KEY: 'my key #with spaces' })
  })

  it('copies only selected OAuth credentials including the Claude runtime alias', async () => {
    await writeFile(join(source, 'config.yaml'), 'model:\n  provider: claude-oauth\n  default: claude-chosen\n')
    await writeFile(join(source, 'auth.json'), JSON.stringify({ providers: {
      'claude-oauth': { tokens: { access_token: 'claude-token', refresh_token: 'claude-refresh' } },
      anthropic: { access_token: 'claude-alias' },
      'openai-codex': { access_token: 'other-provider' },
    }, credential_pool: { anthropic: [{ access_token: 'pooled-claude' }], 'openai-codex': [{ access_token: 'private-other' }] } }))
    const initialize = await prepareBotConnection({ profile: 'research', provider: 'claude-oauth', model: 'claude-chosen' }, root)
    const result = await createProfileWithoutHermes('oauth-bot', false, root, initialize)
    const auth = JSON.parse(await readFile(join(result.path, 'auth.json'), 'utf8'))
    expect(Object.keys(auth.providers)).toEqual(['claude-oauth', 'anthropic'])
    expect(Object.keys(auth.credential_pool)).toEqual(['anthropic'])
    expect((await stat(join(result.path, 'auth.json'))).mode & 0o777).toBe(0o600)
    expect(parseEnv(await readFile(join(result.path, '.env'), 'utf8'))).toEqual({})
  })

  it('rejects nonexistent source Profiles without falling back to default credentials', async () => {
    await expect(prepareBotConnection({ profile: 'missing', provider: 'openai-api', model: 'gpt-selected' }, root)).rejects.toMatchObject({ code: 'profile_not_found' })
    await writeFile(join(source, '.env'), '')
    await expect(prepareBotConnection({ profile: 'research', provider: 'openai-api', model: 'gpt-selected' }, root)).rejects.toMatchObject({ code: 'profile_connection_unavailable' })
    expect(await readdir(join(root, 'profiles'))).toEqual(['research'])
  })

  it.each([false, true])('inherits the latest Profile-local Qwen sidecar with stale auth.json present=%s', async staleAuth => {
    await writeFile(join(source, 'config.yaml'), 'model:\n  provider: qwen-oauth\n  default: coder-model\n')
    await mkdir(join(source, '.qwen'))
    const latest = { access_token: 'fresh-access', refresh_token: 'fresh-refresh', expiry_date: Date.now() + 3600000, token_type: 'Bearer', resource_url: 'portal.qwen.ai' }
    await writeFile(join(source, '.qwen', 'oauth_creds.json'), JSON.stringify(latest))
    if (staleAuth) await writeFile(join(source, 'auth.json'), JSON.stringify({ providers: { 'qwen-oauth': { tokens: { access_token: 'stale-access', refresh_token: 'stale-refresh' } } } }))
    const initialize = await prepareBotConnection({ profile: 'research', provider: 'qwen-oauth', model: 'coder-model' }, root)
    const result = await createProfileWithoutHermes('qwen-bot', false, root, initialize)
    expect(JSON.parse(await readFile(join(result.path, '.qwen', 'oauth_creds.json'), 'utf8'))).toEqual(latest)
    expect(JSON.parse(await readFile(join(result.path, 'auth.json'), 'utf8')).providers['qwen-oauth'].tokens).toEqual(latest)
  })

  it('rejects a model that belongs to a different provider before creation', async () => {
    await expect(prepareBotConnection({ profile: 'research', provider: 'openai-api', model: 'not-an-openai-model' }, root)).rejects.toMatchObject({ code: 'profile_model_unavailable' })
    expect(await readdir(join(root, 'profiles'))).toEqual(['research'])
  })

  it('rejects traversal and a Profile whose config points to another Profile', async () => {
    expect(() => validateSourceConnection({ profile: '../default', provider: 'openai-api', model: 'gpt' })).toThrow()
    await rm(join(source, 'config.yaml'))
    await writeFile(join(root, 'config.yaml'), '{}')
    await symlink(join(root, 'config.yaml'), join(source, 'config.yaml'))
    await expect(prepareBotConnection({ profile: 'research', provider: 'openai-api', model: 'gpt' }, root)).rejects.toMatchObject({ code: 'profile_connection_invalid' })
    await symlink(source, join(root, 'profiles', 'linked'))
    await expect(existingProfileDirectory('linked', root)).rejects.toMatchObject({ code: 'profile_not_found' })
  })

  it('removes staging files if initialization fails and never exposes a partial Bot', async () => {
    await expect(createProfileWithoutHermes('broken-bot', false, root, async directory => {
      await writeFile(join(directory, 'config.yaml'), 'partial')
      throw new Error('Failed to copy connection')
    })).rejects.toThrow('Failed to copy connection')
    expect(existsSync(join(root, 'profiles', 'broken-bot'))).toBe(false)
    expect(await readdir(join(root, 'profiles'))).toEqual(['research'])
  })
})
