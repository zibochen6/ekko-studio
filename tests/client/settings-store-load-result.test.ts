// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const configMock = vi.hoisted(() => ({ fetchConfig: vi.fn(), updateConfigSection: vi.fn() }))
vi.mock('@/api/hermes/config', () => ({
  fetchConfig: configMock.fetchConfig,
  updateConfigSection: configMock.updateConfigSection,
}))

import { useSettingsStore } from '@/stores/hermes/settings'

describe('settings store load result', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('returns true only after settings are loaded', async () => {
    configMock.fetchConfig.mockResolvedValue({ display: { approval_bell: true } })
    const store = useSettingsStore()
    await expect(store.fetchSettings()).resolves.toBe(true)
    expect(store.display.approval_bell).toBe(true)
  })

  it('does not commit a stale load when its generation is no longer active', async () => {
    configMock.fetchConfig.mockResolvedValue({ display: { approval_bell: true } })
    const store = useSettingsStore()
    store.display = { approval_bell: false }

    await expect(store.fetchSettings({ shouldCommit: () => false })).resolves.toBe(false)
    expect(store.display.approval_bell).toBe(false)
  })

  it('ignores a previous Bot settings response after a newer Bot finishes loading', async () => {
    localStorage.setItem('hermes_active_profile_name', 'default')
    let finishA!: (value: unknown) => void
    configMock.fetchConfig.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve }))
    const store = useSettingsStore()
    const first = store.fetchSettings()
    localStorage.setItem('hermes_active_profile_name', 'research')
    configMock.fetchConfig.mockResolvedValueOnce({ display: { approval_bell: false } })
    await store.fetchSettings()
    finishA({ display: { approval_bell: true } })
    expect(await first).toBe(false)
    expect(store.display.approval_bell).toBe(false)
    expect(configMock.fetchConfig).toHaveBeenNthCalledWith(1, undefined, 'default')
    expect(configMock.fetchConfig).toHaveBeenNthCalledWith(2, undefined, 'research')
  })

  it('does not apply an old Bot settings save to the current Bot', async () => {
    localStorage.setItem('hermes_active_profile_name', 'default')
    let finish!: () => void
    configMock.updateConfigSection.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const store = useSettingsStore()
    const save = store.saveSection('display', { approval_bell: true })
    localStorage.setItem('hermes_active_profile_name', 'research')
    store.display = { approval_bell: false }
    finish()
    await save
    expect(store.display.approval_bell).toBe(false)
  })

  it('returns false and keeps the previous display state when loading fails', async () => {
    const store = useSettingsStore()
    store.display = { approval_bell: true }
    configMock.fetchConfig.mockRejectedValue(new Error('unavailable'))
    await expect(store.fetchSettings()).resolves.toBe(false)
    expect(store.display.approval_bell).toBe(true)
  })
})
