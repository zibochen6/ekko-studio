import { readFileSync } from 'fs'
import { join } from 'path'
import { getWebUiHome } from '../../../studio/public/config'
import { safeFileStore } from '../../../studio/public/safe-file-store'
import { ProfileLifecycleError } from './lifecycle'

export interface ProfileIdentity {
  displayName?: string
  description?: string
  updatedAt?: number
}

interface ProfileMetadata extends ProfileIdentity {
  profileOnlyCredentials?: boolean
}

export function profileMetadataDir(name: string): string {
  return join(getWebUiHome(), 'profile-metadata', Buffer.from(name || 'default', 'utf8').toString('base64url'))
}

export function validateProfileIdentity(value: unknown): Pick<ProfileIdentity, 'displayName' | 'description'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfileLifecycleError('Invalid Bot identity', 400, 'profile_identity_invalid')
  }
  const input = value as Record<string, unknown>
  const result: Pick<ProfileIdentity, 'displayName' | 'description'> = {}
  for (const [field, limit] of [['displayName', 80], ['description', 280]] as const) {
    if (input[field] === undefined) continue
    if (typeof input[field] !== 'string' || [...input[field]].length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[field])) {
      throw new ProfileLifecycleError(`${field} must be text of at most ${limit} characters`, 400, 'profile_identity_invalid')
    }
    result[field] = input[field].trim()
  }
  return result
}

function parseIdentity(raw: string): ProfileMetadata {
  try {
    const parsed = JSON.parse(raw)
    return {
      ...validateProfileIdentity(parsed),
      ...(typeof parsed.updatedAt === 'number' ? { updatedAt: parsed.updatedAt } : {}),
      ...(parsed.profileOnlyCredentials === true ? { profileOnlyCredentials: true } : {}),
    }
  } catch {
    return {}
  }
}

function readProfileMetadata(name: string): ProfileMetadata {
  try {
    return parseIdentity(readFileSync(join(profileMetadataDir(name), 'identity.json'), 'utf8'))
  } catch {
    return {}
  }
}

export function readProfileIdentity(name: string): ProfileIdentity {
  const { profileOnlyCredentials: _private, ...identity } = readProfileMetadata(name)
  return identity
}

export function usesProfileOnlyCredentials(name: string): boolean {
  return readProfileMetadata(name).profileOnlyCredentials === true
}

export async function saveProfileIdentity(name: string, value: unknown, options: { profileOnlyCredentials?: true } = {}): Promise<ProfileIdentity> {
  const patch = validateProfileIdentity(value)
  return (await safeFileStore.updateText<ProfileIdentity>(join(profileMetadataDir(name), 'identity.json'), raw => {
    const metadata = { ...parseIdentity(raw), ...patch, ...options, updatedAt: Date.now() }
    const { profileOnlyCredentials: _private, ...identity } = metadata
    return { content: JSON.stringify(metadata, null, 2) + '\n', result: identity }
  }))!
}
