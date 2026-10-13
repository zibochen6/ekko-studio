import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync } from 'fs'
import { homedir } from 'os'
import { extname, join } from 'path'
import YAML from 'js-yaml'
import { logger } from '../../../studio/public/logging'
import { getActiveProfileName, getProfileDir, listProfileNamesFromDisk } from './profile'
import { existingProfileDirectory } from './lifecycle'

export interface HermesProfile {
  name: string
  active: boolean
  model: string
  gatewayStatus?: string
  alias: string
}

export async function readProfileDetailFromDisk(name: string) {
  const path = await existingProfileDirectory(name)
  const configPath = join(path, 'config.yaml')
  const config = existsSync(configPath) ? YAML.load(readFileSync(configPath, 'utf8'), { json: true }) as Record<string, any> | null : null
  const model = config?.model
  let skills = 0
  try { skills = readdirSync(join(path, 'skills'), { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).length } catch {}
  return {
    name,
    path,
    model: typeof model === 'string' ? model.trim() : String(model?.default || '').trim(),
    provider: typeof model === 'object' ? String(model?.provider || '').trim() : '',
    skills,
    hasEnv: existsSync(join(path, '.env')),
    hasSoulMd: existsSync(join(path, 'SOUL.md')),
  }
}

export function readProfileDefaultModel(name: string): string {
  const configPath = join(getProfileDir(name), 'config.yaml')
  if (!existsSync(configPath)) return '—'
  try {
    const config = YAML.load(readFileSync(configPath, 'utf-8'), { json: true }) as Record<string, any> | null
    const model = config?.model
    if (typeof model === 'string') return model.trim() || '—'
    if (model && typeof model === 'object') return String(model.default || '').trim() || '—'
  } catch (err) {
    logger.warn(err, 'Failed to read profile config model for %s', name)
  }
  return '—'
}

function readProfileAliases(): Map<string, string> {
  const aliases = new Map<string, string>()
  const wrapperDir = join(homedir(), '.local', 'bin')
  try {
    // Hermes stores aliases in wrapper scripts. Read only their heads: this
    // directory can also contain large binaries, and listing must stay cheap.
    const head = Buffer.alloc(8192)
    for (const entry of readdirSync(wrapperDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile()) continue
      const extension = extname(entry.name)
      if (process.platform === 'win32' ? extension !== '.bat' : !!extension) continue
      let fd: number | undefined
      try {
        fd = openSync(join(wrapperDir, entry.name), 'r')
        const bytes = readSync(fd, head, 0, head.length, 0)
        const content = head.subarray(0, bytes)
        if (content.includes(0)) continue
        const name = content.toString('utf-8').match(/hermes -p ([^\s]+)/)?.[1]
        if (!name) continue
        const alias = process.platform === 'win32' ? entry.name.slice(0, -4) : entry.name
        if (alias !== name || !aliases.has(name)) aliases.set(name, alias)
      } catch {
        // A missing/unreadable optional wrapper does not hide a profile.
      } finally {
        if (fd !== undefined) closeSync(fd)
      }
    }
  } catch {}
  return aliases
}

/** Basic page data must never start Hermes or probe Bridge/Gateway status. */
export function listProfilesFromDisk(activeProfileName = getActiveProfileName()): HermesProfile[] {
  const names = listProfileNamesFromDisk()
  const aliases = names.length > 1 ? readProfileAliases() : new Map<string, string>()
  return names.map(name => ({
    name,
    active: name === activeProfileName,
    model: readProfileDefaultModel(name),
    alias: name === 'default' ? '' : aliases.get(name) || '',
  }))
}
