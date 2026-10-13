import boring from 'boring-avatars-vanilla'
import { ref } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import type { HermesProfile, ProfileAvatar } from '@/api/hermes/profiles'

// Cross-Profile transport, ownership and workspace browser checks guard this default.
export const BOT_WORKSPACE_ENABLED = true
export function isBotWorkspaceRoute(route: Pick<RouteLocationNormalizedLoaded, 'name' | 'query'>): boolean {
  return (BOT_WORKSPACE_ENABLED || route.query?.workspace === 'bots')
    && route.query?.studio !== '1'
    && ['hermes.chat', 'hermes.session'].includes(String(route.name))
}
export function botDisplayName(profile?: Pick<HermesProfile, 'name' | 'displayName'> | null): string {
  return profile?.displayName?.trim() || profile?.name || 'Hermes'
}
export const botRosterCollapsed = ref(localStorage.getItem('studio_bot_roster_collapsed') === 'true')
export function toggleBotRoster() {
  botRosterCollapsed.value = !botRosterCollapsed.value
  localStorage.setItem('studio_bot_roster_collapsed', String(botRosterCollapsed.value))
}

export function botAvatarSource(name: string, avatar?: ProfileAvatar | null): string {
  if (avatar?.type === 'image' && avatar.dataUrl) return avatar.dataUrl
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(boring({ name: avatar?.seed || name || 'default', variant: 'beam', size: 64 }))}`
}
