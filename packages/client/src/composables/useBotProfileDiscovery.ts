import { onMounted, onUnmounted } from 'vue'
import { useProfilesStore } from '@/stores/hermes/profiles'

/** Re-read the configured Hermes home when returning from an external CLI. */
export function useBotProfileDiscovery() {
  const profiles = useProfilesStore()
  let lastRefreshAt = -Infinity

  function refresh() {
    lastRefreshAt = Date.now()
    return profiles.fetchProfiles()
  }

  function refreshOnReturn() {
    // Focus and visibility commonly fire together. Hidden windows should not
    // poll or change their selected Bot while another window is being used.
    if (document.visibilityState !== 'visible' || Date.now() - lastRefreshAt < 1500) return
    void refresh()
  }

  onMounted(() => {
    void refresh()
    window.addEventListener('focus', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshOnReturn)
  })
  onUnmounted(() => {
    window.removeEventListener('focus', refreshOnReturn)
    document.removeEventListener('visibilitychange', refreshOnReturn)
  })

  return { refresh }
}
