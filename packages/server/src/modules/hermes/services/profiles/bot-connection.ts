import { lstat, mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { parseEnv } from 'node:util'
import YAML from 'js-yaml'
import { getCompatibleCustomProviders } from '../../../studio/contracts/provider-compat'
import { buildProviderModelMap, PROVIDER_PRESETS } from '../../../studio/contracts/providers'
import { readAppConfig } from '../../../studio/public/app-config'
import { detectHermesRootHome, isRealPathWithin } from '../runtime/path'
import { readProviderModelCatalogCache, resolveProviderCatalogEntry } from '../providers/model-catalog-cache'
import { PROVIDER_ENV_MAP } from './config'
import { existingProfileDirectory, ProfileLifecycleError, validateProfileName } from './lifecycle'

export interface ProfileSourceConnection {
  profile: string
  provider: string
  model: string
}

const OAUTH_CONNECTION_ENV: Record<string, string[]> = {
  'openai-codex': ['HERMES_CODEX_BASE_URL'],
  'xai-oauth': ['HERMES_XAI_BASE_URL', 'XAI_BASE_URL'],
  nous: ['NOUS_INFERENCE_BASE_URL', 'NOUS_PORTAL_BASE_URL', 'HERMES_PORTAL_BASE_URL'],
}

export function validateSourceConnection(value: unknown): ProfileSourceConnection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfileLifecycleError('Invalid source model connection', 400, 'profile_connection_invalid')
  }
  const input = value as Record<string, unknown>
  const profile = validateProfileName(input.profile, { allowDefault: true })
  for (const field of ['provider', 'model'] as const) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 256 || /[\r\n\u0000]/.test(input[field])) {
      throw new ProfileLifecycleError(`A source ${field} is required`, 400, 'profile_connection_invalid')
    }
  }
  return { profile, provider: (input.provider as string).trim(), model: (input.model as string).trim() }
}

async function readLocalFile(directory: string, name: string): Promise<string> {
  const path = join(directory, name)
  if (!await lstat(path).catch(() => null)) return ''
  if (!await isRealPathWithin(path, directory)) {
    throw new ProfileLifecycleError(`Source ${name} resolves outside its Profile`, 400, 'profile_connection_invalid')
  }
  return readFile(path, 'utf8')
}

function parseObject(raw: string, format: 'yaml' | 'json'): Record<string, any> {
  if (!raw.trim()) return {}
  const value = format === 'yaml' ? YAML.load(raw, { json: true }) : JSON.parse(raw)
  if (value === null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, any>
}

function envLine(key: string, value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\r\n\u0000]/.test(value)) {
    throw new ProfileLifecycleError('Source model credential has an unsupported format', 400, 'profile_connection_invalid')
  }
  if (/^[^\s#'"]+$/.test(value)) return `${key}=${value}`
  if (!value.includes('"')) return `${key}="${value}"`
  if (!value.includes("'")) return `${key}='${value}'`
  if (/^[^\s#'"=][^\s#]*$/.test(value)) return `${key}=${value}`
  throw new ProfileLifecycleError('Source model credential has an unsupported format', 400, 'profile_connection_invalid')
}

function hasOAuthCredential(auth: Record<string, any>, key: string): boolean {
  const provider = auth.providers?.[key]
  const pool = auth.credential_pool?.[key]
  return !!(provider?.tokens?.access_token || provider?.access_token || provider?.agent_key
    || (Array.isArray(pool) && pool.some(entry => entry?.access_token || entry?.agent_key)))
}

/** Read only the chosen connection from an explicit source, never the global active Profile. */
export async function prepareBotConnection(
  source: ProfileSourceConnection,
  root = detectHermesRootHome(),
): Promise<(directory: string) => Promise<void>> {
  const directory = await existingProfileDirectory(source.profile, root)
  let config: Record<string, any>
  let auth: Record<string, any>
  let env: Record<string, string>
  let qwenCredentials: Record<string, any> = {}
  try {
    const [rawConfig, rawEnv, rawAuth, rawQwen] = await Promise.all([
      readLocalFile(directory, 'config.yaml'), readLocalFile(directory, '.env'), readLocalFile(directory, 'auth.json'),
      source.provider === 'qwen-oauth' ? readLocalFile(directory, join('.qwen', 'oauth_creds.json')) : Promise.resolve(''),
    ])
    config = parseObject(rawConfig, 'yaml')
    auth = parseObject(rawAuth, 'json')
    qwenCredentials = parseObject(rawQwen, 'json')
    env = Object.fromEntries(Object.entries(parseEnv(rawEnv)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch (error) {
    if (error instanceof ProfileLifecycleError) throw error
    throw new ProfileLifecycleError('Source model configuration could not be read', 400, 'profile_connection_invalid')
  }

  const targetConfig: Record<string, any> = { model: { default: source.model, provider: source.provider } }
  const targetAuth: Record<string, any> = {}
  const targetEnv: Record<string, string> = {}
  const normalize = (name: string) => name.trim().toLowerCase().replace(/ /g, '-')
  const custom = getCompatibleCustomProviders(config).find(entry =>
    `custom:${normalize(entry.name)}` === source.provider
    || (entry.provider_key === source.provider && !PROVIDER_ENV_MAP[source.provider]),
  )
  const selectedModelConfig = custom?.models?.[source.model] || config.providers?.[source.provider]?.models?.[source.model]

  if (custom) {
    const { source: _source, provider_key: _providerKey, models: _models, ...connection } = custom
    connection.model = source.model
    // Per-model transport/context metadata belongs to this connection. Other models do not.
    const modelMetadata = custom.models?.[source.model]
    targetConfig.custom_providers = [{ ...connection, ...(modelMetadata ? { models: { [source.model]: modelMetadata } } : {}) }]
    targetConfig.model.base_url = custom.base_url
    if (custom.api_mode) targetConfig.model.api_mode = custom.api_mode
    if (selectedModelConfig?.context_length || custom.context_length) targetConfig.model.context_length = selectedModelConfig?.context_length || custom.context_length
    if (custom.key_env) {
      if (!env[custom.key_env]?.trim()) {
        throw new ProfileLifecycleError('Source model credential is missing from its Profile', 400, 'profile_connection_unavailable')
      }
      targetEnv[custom.key_env] = env[custom.key_env]
    }
  } else {
    const mapping = PROVIDER_ENV_MAP[source.provider]
    if (!mapping) throw new ProfileLifecycleError('Source model provider is not configured', 400, 'profile_connection_unavailable')
    const authKeys = source.provider === 'claude-oauth' ? ['claude-oauth', 'anthropic'] : [source.provider]
    const authorizedKeys = authKeys.filter(key => hasOAuthCredential(auth, key))
    const hasLocalQwen = source.provider === 'qwen-oauth' && (qwenCredentials.access_token || qwenCredentials.refresh_token)
    const apiKey = mapping.api_key_env && env[mapping.api_key_env]
    if (!apiKey?.trim() && authorizedKeys.length === 0 && !hasLocalQwen) {
      throw new ProfileLifecycleError('Source model credential is missing from its Profile', 400, 'profile_connection_unavailable')
    }
    for (const key of [mapping.api_key_env, mapping.base_url_env, ...(OAUTH_CONNECTION_ENV[source.provider] || [])]) {
      if (key && env[key]) targetEnv[key] = env[key]
    }
    for (const key of authKeys) {
      if (auth.providers?.[key]) targetAuth.providers = { ...targetAuth.providers, [key]: auth.providers[key] }
      if (auth.credential_pool?.[key]) targetAuth.credential_pool = { ...targetAuth.credential_pool, [key]: auth.credential_pool[key] }
    }
    if (hasLocalQwen) {
      // Qwen refreshes update its local sidecar, so auth.json may contain an
      // expired access token and a superseded refresh token from initial import.
      targetAuth.providers = { 'qwen-oauth': { tokens: { ...qwenCredentials } } }
      delete targetAuth.credential_pool
    }
    if (config.model && typeof config.model === 'object' && config.model.provider === source.provider) {
      for (const key of ['base_url', 'api_mode']) {
        if (config.model[key] !== undefined) targetConfig.model[key] = config.model[key]
      }
      if (config.model.default === source.model && config.model.context_length) targetConfig.model.context_length = config.model.context_length
    }
    if (selectedModelConfig && typeof selectedModelConfig === 'object') {
      targetConfig.providers = { [source.provider]: { models: { [source.model]: selectedModelConfig } } }
      if (selectedModelConfig.context_length) targetConfig.model.context_length = selectedModelConfig.context_length
      if (selectedModelConfig.api_mode) targetConfig.model.api_mode = selectedModelConfig.api_mode
    }
  }

  const presetKey = source.provider.replace(/^custom:/, '')
  const preset = PROVIDER_PRESETS.find(entry => entry.value === presetKey)
  const baseUrl = custom?.base_url || targetEnv[PROVIDER_ENV_MAP[source.provider]?.base_url_env] || targetConfig.model.base_url || preset?.base_url || ''
  const [catalog, appConfig] = await Promise.all([readProviderModelCatalogCache(), readAppConfig()])
  const cachedModels = resolveProviderCatalogEntry(catalog, source.provider, baseUrl, { profile: source.profile, freeOnly: source.provider === 'openrouter' })
  const customModels = appConfig.customModels?.[source.provider]
  const sourceDefaultMatches = config.model?.provider === source.provider
    || (custom && config.model?.provider === 'custom' && String(config.model.base_url || '').replace(/\/+$/, '') === custom.base_url.replace(/\/+$/, ''))
  const availableModels = new Set([
    ...(buildProviderModelMap()[presetKey] || preset?.models || []),
    ...(cachedModels?.models || []),
    ...(Array.isArray(customModels) ? customModels : []),
    ...(custom?.model ? [custom.model] : []),
    ...Object.keys(custom?.models || config.providers?.[source.provider]?.models || {}),
    ...(sourceDefaultMatches && config.model.default ? [config.model.default] : []),
  ])
  if (!availableModels.has(source.model) || cachedModels?.unavailable_models?.includes(source.model)) {
    throw new ProfileLifecycleError('The selected model is not available from the source provider', 400, 'profile_model_unavailable')
  }

  const configText = YAML.dump(targetConfig, { lineWidth: -1, noRefs: true })
  const envText = Object.entries(targetEnv).map(([key, value]) => envLine(key, value)).join('\n') + '\n'
  const authText = Object.keys(targetAuth).length ? JSON.stringify(targetAuth, null, 2) + '\n' : ''
  const qwenState = source.provider === 'qwen-oauth'
    ? targetAuth.providers?.['qwen-oauth'] || targetAuth.credential_pool?.['qwen-oauth']?.find((entry: any) => entry?.access_token)
    : undefined
  const qwenTokens = qwenState?.tokens || qwenState
  const qwenSidecar = qwenTokens?.access_token || qwenTokens?.refresh_token ? {
    access_token: qwenTokens.access_token,
    refresh_token: qwenTokens.refresh_token,
    expiry_date: qwenTokens.expiry_date || qwenTokens.expires_at_ms || qwenTokens.expires_at,
    token_type: qwenTokens.token_type || 'Bearer',
    ...(qwenTokens.resource_url ? { resource_url: qwenTokens.resource_url } : {}),
  } : undefined
  return async targetDirectory => {
    await writeFile(join(targetDirectory, 'config.yaml'), configText, { mode: 0o600 })
    await writeFile(join(targetDirectory, '.env'), envText, { mode: 0o600 })
    if (authText) await writeFile(join(targetDirectory, 'auth.json'), authText, { mode: 0o600 })
    if (qwenSidecar) {
      await mkdir(join(targetDirectory, '.qwen'), { mode: 0o700 })
      await writeFile(join(targetDirectory, '.qwen', 'oauth_creds.json'), JSON.stringify(qwenSidecar, null, 2) + '\n', { mode: 0o600 })
    }
  }
}
