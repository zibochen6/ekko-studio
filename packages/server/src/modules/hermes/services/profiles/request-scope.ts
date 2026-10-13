import { AsyncLocalStorage } from 'async_hooks'
import { lstatSync, realpathSync } from 'fs'
import { existingProfileDirectory, ProfileLifecycleError, validateProfileName } from './lifecycle'

interface ProfileDirectoryScope {
  name: string
  directory: string
  realDirectory: string
}

const profileDirectoryScope = new AsyncLocalStorage<ProfileDirectoryScope>()

/** Pin explicit requests without serializing long-running work or other controls. */
export async function withExplicitProfileDirectory<T>(name: string, action: () => Promise<T>): Promise<T> {
  if (validateProfileName(name, { allowDefault: true, allowReserved: true }) !== name) {
    throw new ProfileLifecycleError('Profile name must use its exact internal identifier', 400, 'profile_name_invalid')
  }
  const directory = await existingProfileDirectory(name, undefined, { allowReserved: true })
  const scope = { name, directory, realDirectory: realpathSync(directory) }
  return profileDirectoryScope.run(scope, action)
}

export function getRequestProfileDirectory(name: string): string | undefined {
  const scope = profileDirectoryScope.getStore()
  if (!scope || scope.name !== name) return undefined
  try {
    const stat = lstatSync(scope.directory)
    if (stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(scope.directory) === scope.realDirectory) {
      return scope.directory
    }
  } catch {}
  // A deletion during an awaited operation must never redirect a later read or
  // write to the default Profile through the legacy directory fallback.
  throw new ProfileLifecycleError(`Profile '${name}' does not exist`, 404, 'profile_not_found')
}
