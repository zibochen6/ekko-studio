export const BOT_MANAGEMENT_ROUTES = new Set(['hermes.skills', 'hermes.jobs', 'hermes.kanban'])

interface ProfileSelection {
  profiles: Array<{ name: string }>
  activeProfileName: string | null
  fetchProfiles(): Promise<void>
  switchProfile(name: string): Promise<boolean>
}

/** Resolve an explicit management link before its page can issue requests. */
export async function applyBotManagementProfile(
  requested: unknown,
  profiles: ProfileSelection,
  isCurrent: () => boolean,
): Promise<boolean> {
  const name = typeof requested === 'string' ? requested.trim() : ''
  if (requested != null && !name) return false
  if (!profiles.profiles.length || (name && !profiles.profiles.some(profile => profile.name === name))) {
    await profiles.fetchProfiles()
  }
  if (!isCurrent()) return false
  if (!name) return true
  // An unavailable Profile must never silently open another Bot's editor.
  if (!profiles.profiles.some(profile => profile.name === name)) return false
  if (profiles.activeProfileName !== name) await profiles.switchProfile(name)
  return isCurrent() && profiles.activeProfileName === name
}
