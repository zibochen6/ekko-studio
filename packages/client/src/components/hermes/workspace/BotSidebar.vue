<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NDropdown, NPopover } from 'naive-ui'
import { isStoredSuperAdmin } from '@/api/client'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { useChatStore } from '@/stores/hermes/chat'
import type { HermesProfile } from '@/api/hermes/profiles'
import ProfileAvatar from '@/components/hermes/profiles/ProfileAvatar.vue'
import PageSidebarFooter from '@/components/layout/PageSidebarFooter.vue'
import BotIdentityDrawer from './BotIdentityDrawer.vue'
import BotConfigDrawer from './BotConfigDrawer.vue'
import { botDisplayName, botRosterCollapsed, toggleBotRoster } from '@/utils/bot-workspace'
import { BOT_MANAGEMENT_ROUTES } from '@/utils/bot-management-route'
import { useBotProfileDiscovery } from '@/composables/useBotProfileDiscovery'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const profiles = useProfilesStore()
const { refresh } = useBotProfileDiscovery()
const chat = useChatStore()
const showIdentity = ref(false)
const editingProfile = ref<HermesProfile | null>(null)
const showConfig = ref(false)
const showTools = ref(false)
const canManage = computed(() => isStoredSuperAdmin())
const tools = computed(() => [
  { label: t('sidebar.skills'), key: 'hermes.skills' },
  { label: t('sidebar.jobs'), key: 'hermes.jobs' },
  { label: t('botWorkspace.sharedKanban'), key: 'hermes.kanban' },
  { type: 'divider' as const, key: 'bot-tools-divider' },
  { label: t('botWorkspace.otherAgents'), key: 'hermes.chat' },
  { label: t('sidebar.groupChat'), key: 'hermes.groupChat' },
  { label: t('sidebar.workflow'), key: 'hermes.workflow' },
  { label: t('sidebar.history'), key: 'hermes.history' },
  { label: t('sidebar.connections'), key: 'hermes.connections' },
  ...(canManage.value ? [{ label: t('sidebar.agentManager'), key: 'hermes.agentManager' }] : []),
  { label: t('sidebar.models'), key: 'hermes.models' },
  { label: t('sidebar.usage'), key: 'hermes.usage' },
  { label: t('sidebar.apiRelay'), key: 'hermes.apiRelay' },
  { label: t('sidebar.settings'), key: 'hermes.settings' },
  { type: 'divider' as const, key: 'discovery-divider' },
  { label: t('botWorkspace.refreshBots'), key: 'refresh-bots', disabled: profiles.loading },
])
function selectProfile(name: string) {
  showIdentity.value = false
  void router.push({ name: 'hermes.chat', query: { profile: name, ...(route.query.workspace === 'bots' ? { workspace: 'bots' } : {}) } })
}
function edit(profile: HermesProfile) { editingProfile.value = profile; showIdentity.value = true }
function create() { editingProfile.value = null; showIdentity.value = true }
function activity(profile: string) { return chat.getProfileActivity(profile) }
function status(profile: string) {
  const state = activity(profile)
  if (state.pending) return t('botWorkspace.waiting')
  if (state.working) return t('botWorkspace.working')
  if (state.unread) return t('botWorkspace.completed')
  return ''
}
function openTool(name: string | number) {
  showTools.value = false
  if (name === 'refresh-bots') { void refresh(); return }
  const query = name === 'hermes.chat' ? { studio: '1' }
    : BOT_MANAGEMENT_ROUTES.has(String(name)) ? { profile: profiles.activeProfileName || 'default' } : undefined
  void router.push({ name: String(name), query })
}
watch(() => profiles.profiles.map(profile => profile.name), names => { void chat.observeProfiles(names) }, { immediate: true })
</script>
<template>
  <aside class="bot-sidebar" :class="{ 'bot-sidebar--collapsed': botRosterCollapsed }" :aria-label="t('botWorkspace.bots')">
    <header class="bot-sidebar__brand">
      <img src="/logo.png" width="32" height="32" alt="Ekko Studio">
      <span v-if="!botRosterCollapsed">Ekko<span class="brand-secondary"> Studio</span></span>
      <button class="bot-icon-button roster-toggle" type="button" :aria-label="t(botRosterCollapsed ? 'botWorkspace.expandBots' : 'botWorkspace.collapseBots')" :aria-expanded="!botRosterCollapsed" @click="toggleBotRoster">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>
      </button>
    </header>
    <div v-if="!botRosterCollapsed" class="bot-sidebar__eyebrow">{{ t('botWorkspace.personalWorkspace') }}</div>
    <nav class="bot-sidebar__list">
      <div v-for="profile in profiles.profiles" :key="profile.name" class="bot-row" :class="{ 'bot-row--selected': profile.name === profiles.activeProfileName }">
        <button class="bot-row__select" type="button" :title="`${botDisplayName(profile)}${status(profile.name) ? ' · ' + status(profile.name) : ''}`" :aria-current="profile.name === profiles.activeProfileName ? 'page' : undefined" @click="selectProfile(profile.name)">
          <span class="bot-row__avatar"><ProfileAvatar :name="profile.name" :avatar="profile.avatar" :size="36" /><span v-if="status(profile.name)" class="bot-status-dot" :class="{ working: activity(profile.name).working, pending: activity(profile.name).pending, unread: activity(profile.name).unread }" /></span>
          <span v-if="!botRosterCollapsed" class="bot-row__copy"><strong dir="auto">{{ botDisplayName(profile) }}</strong><small>{{ status(profile.name) || profile.description || t('botWorkspace.ready') }}</small></span>
        </button>
        <NPopover v-if="canManage && !botRosterCollapsed" trigger="click" placement="right-start" :show-arrow="false">
          <template #trigger><button class="bot-row__edit bot-icon-button" :aria-label="t('botWorkspace.botActions', { name: botDisplayName(profile) })" type="button">···</button></template>
          <div class="bot-context"><button type="button" @click="edit(profile)">{{ t('botWorkspace.editBot') }}</button><button type="button" @click="editingProfile = profile; showConfig = true">{{ t('botWorkspace.configuration') }}</button></div>
        </NPopover>
      </div>
      <button v-if="canManage" type="button" class="bot-create" :title="t('botWorkspace.createBot')" @click="create"><span aria-hidden="true">＋</span><span v-if="!botRosterCollapsed">{{ t('botWorkspace.createBot') }}</span></button>
    </nav>
    <footer class="bot-sidebar__footer">
      <NDropdown trigger="click" :options="tools" :show="showTools" placement="right-end" @update:show="showTools = $event" @select="openTool">
        <button class="bot-tools" type="button" :aria-label="t('botWorkspace.studioTools')" :aria-expanded="showTools" @click="showTools = !showTools"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg><span v-if="!botRosterCollapsed">{{ t('botWorkspace.studioTools') }}</span></button>
      </NDropdown>
      <PageSidebarFooter rail :collapsed="botRosterCollapsed" />
    </footer>
    <BotIdentityDrawer v-model:show="showIdentity" :profile="editingProfile" @created="selectProfile" />
    <BotConfigDrawer v-model:show="showConfig" :profile="editingProfile" />
  </aside>
</template>
<style scoped lang="scss">
.bot-sidebar { position: relative; z-index: 2; flex: 0 0 200px; width: 200px; min-height: 0; display: flex; flex-direction: column; padding: 16px 12px 8px; background: var(--bg-sidebar); border-inline-end: 1px solid var(--border-color); box-sizing: border-box; }
.bot-sidebar__brand { display: flex; gap: 8px; align-items: center; height: 40px; font-size: 16px; font-weight: 650; letter-spacing: -.5px; margin-bottom: 24px; -webkit-app-region: drag; }
.bot-sidebar__brand img { flex-shrink: 0; }
.brand-secondary { font-weight: 450; }
.bot-icon-button { display: grid; place-items: center; border: 0; padding: 4px; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 6px; -webkit-app-region: no-drag; }
.bot-icon-button:hover { background: var(--bg-secondary); color: var(--text-primary); }
.roster-toggle { margin-inline-start: auto; }
.bot-sidebar__eyebrow { padding: 0 8px 16px; font-size: 11px; font-weight: 500; letter-spacing: .5px; color: var(--text-muted); }
.bot-sidebar__list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.bot-row { display: flex; position: relative; border-radius: 12px; min-height: 64px; transition: background-color 140ms ease-out; }
.bot-row:hover { background: var(--bg-secondary); }
.bot-row--selected { background: var(--bg-card); box-shadow: 0 1px 4px rgba(0,0,0,.04), inset 0 0 0 1px var(--border-color); }
.bot-row__select { display: flex; align-items: center; flex: 1; min-width: 0; gap: 12px; border: 0; background: transparent; padding: 12px 8px; text-align: start; cursor: pointer; color: var(--text-primary); border-radius: 12px; }
.bot-row__avatar { position: relative; display: flex; flex-shrink: 0; }
.bot-row__copy { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
.bot-row__copy strong { font-size: 13px; font-weight: 550; }
.bot-row__copy small { font-size: 11px; color: var(--text-muted); }
.bot-row__copy strong, .bot-row__copy small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bot-row__edit { position: absolute; inset-inline-end: 4px; top: 4px; opacity: 0; }
.bot-row:hover .bot-row__edit, .bot-row:focus-within .bot-row__edit { opacity: 1; }
.bot-status-dot { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #529e77; bottom: 0; inset-inline-end: 0; border: 2px solid var(--bg-sidebar); }
.bot-status-dot.working { background: #5393d2; }.bot-status-dot.pending { background: #c68c37; }.bot-status-dot.unread { background: #529e77; }
.bot-create, .bot-tools { display: flex; align-items: center; gap: 12px; padding: 12px; border: 0; border-radius: 10px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; text-align: start; }
.bot-create { margin-top: 8px; }.bot-create > span:first-child { font-size: 20px; width: 24px; text-align: center; }.bot-create:hover, .bot-tools:hover { background: var(--bg-secondary); color: var(--text-primary); }
.bot-sidebar__footer { border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 16px; }.bot-tools { width: 100%; }.bot-sidebar__footer :deep(.page-sidebar-bottom) { padding: 8px 0 0; }
.bot-sidebar button:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -2px; }
.bot-sidebar--collapsed { flex-basis: 72px; width: 72px; padding-inline: 8px; }.bot-sidebar--collapsed .bot-sidebar__brand { flex-direction: column; height: 64px; gap: 8px; margin-bottom: 24px; }.bot-sidebar--collapsed .roster-toggle { margin-inline-start: 0; }.bot-sidebar--collapsed .bot-row__select { justify-content: center; padding: 8px; }.bot-sidebar--collapsed .bot-row { min-height: 56px; }.bot-sidebar--collapsed .bot-create, .bot-sidebar--collapsed .bot-tools { justify-content: center; padding: 12px 8px; }
.bot-context { display: flex; flex-direction: column; gap: 4px; }.bot-context button { border: 0; background: transparent; text-align: start; padding: 8px 12px; color: var(--text-primary); cursor: pointer; border-radius: 6px; }.bot-context button:hover { background: var(--bg-secondary); }
:global(.desktop-platform-darwin .bot-sidebar) { padding-top: 48px; }
@media (prefers-reduced-motion: reduce) { .bot-row { transition: none; } }
</style>
