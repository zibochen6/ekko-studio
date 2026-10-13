import { describe, expect, it, vi } from 'vitest'
import { applyBotManagementProfile } from '@/utils/bot-management-route'

function selection() {
  const store = {
    profiles: [{ name: 'default' }, { name: 'research' }],
    activeProfileName: 'default',
    fetchProfiles: vi.fn(async () => {}),
    switchProfile: vi.fn(async (name: string) => { store.activeProfileName = name; return true }),
  }
  return store
}

describe('Bot management route Profile selection', () => {
  it('selects the explicit link owner before opening its management page', async () => {
    const store = selection()
    expect(await applyBotManagementProfile('research', store, () => true)).toBe(true)
    expect(store.activeProfileName).toBe('research')
    expect(store.switchProfile).toHaveBeenCalledWith('research')
  })

  it('keeps an unqualified legacy link on the current Bot', async () => {
    const store = selection()
    store.activeProfileName = 'research'
    expect(await applyBotManagementProfile(undefined, store, () => true)).toBe(true)
    expect(store.switchProfile).not.toHaveBeenCalled()
  })

  it.each(['missing', '', ['default', 'research']])('refuses unavailable or ambiguous explicit Profiles: %s', async name => {
    const store = selection()
    expect(await applyBotManagementProfile(name, store, () => true)).toBe(false)
    expect(store.switchProfile).not.toHaveBeenCalled()
  })

  it('does not switch after a late discovery response for an abandoned navigation', async () => {
    const store = selection()
    store.profiles = []
    let release!: () => void
    store.fetchProfiles.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
    let current = true
    const pending = applyBotManagementProfile('research', store, () => current)
    current = false
    store.profiles = [{ name: 'research' }]
    release()
    expect(await pending).toBe(false)
    expect(store.switchProfile).not.toHaveBeenCalled()
  })
})
