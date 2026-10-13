// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

const { fetchProfiles } = vi.hoisted(() => ({ fetchProfiles: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/stores/hermes/profiles', () => ({ useProfilesStore: () => ({ fetchProfiles }) }))
import { useBotProfileDiscovery } from '@/composables/useBotProfileDiscovery'

describe('local Bot discovery', () => {
  let wrapper: VueWrapper | undefined
  let refresh: () => Promise<void>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    wrapper = mount(defineComponent({
      setup() { ({ refresh } = useBotProfileDiscovery()); return () => null },
    }))
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('discovers externally created Profiles on return without duplicate focus/visibility loads', () => {
    expect(fetchProfiles).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetchProfiles).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(2000)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetchProfiles).toHaveBeenCalledTimes(3)
  })

  it('does not refresh a hidden or unmounted workspace', () => {
    vi.advanceTimersByTime(2000)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetchProfiles).toHaveBeenCalledTimes(1)
    wrapper?.unmount()
    wrapper = undefined
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetchProfiles).toHaveBeenCalledTimes(1)
  })

  it('allows an explicit scan immediately after an automatic scan', async () => {
    await refresh()
    expect(fetchProfiles).toHaveBeenCalledTimes(2)
  })
})
