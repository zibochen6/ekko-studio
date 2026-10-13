<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { isBotWorkspaceRoute } from '@/utils/bot-workspace'
import PageLoading from '@/components/common/PageLoading.vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from '@/components/hermes/chat/ChatPanel.vue'
import { useAppStore } from '@/stores/hermes/app'
import { useChatStore } from '@/stores/hermes/chat'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { useSettingsStore } from '@/stores/hermes/settings'
import { fetchSessionContext } from '@/api/studio/sessions'

const appStore = useAppStore()
const chatStore = useChatStore()
const profilesStore = useProfilesStore()
const settingsStore = useSettingsStore()
const route = useRoute()
const router = useRouter()

const routeSessionId = computed(() => {
  const value = route.params.sessionId
  return typeof value === 'string' && value.trim() ? value : null
})

const routeProfile = computed(() => {
  const value = route.query.profile
  return typeof value === 'string' && value.trim() ? value : null
})

const botWorkspace = computed(() => isBotWorkspaceRoute(route))
const isStandaloneChat = computed(() => route.meta?.standaloneChat === true)
type ChatContentMode = 'chat' | 'connections' | 'agents' | 'models'

const contentMode = computed<ChatContentMode>(() => {
  if (route.name === 'hermes.connections') return 'connections'
  if (route.name === 'hermes.agentManager') return 'agents'
  if (route.name === 'hermes.models') return 'models'
  return 'chat'
})
const productTitle = 'Ekko Studio'
const initializing = ref(true)
const routeLoading = ref(false)
let routeLoadSequence = 0
let profileApplySequence = 0
let disposed = false
const pageLoading = computed(() => contentMode.value === 'chat' && (
  initializing.value || routeLoading.value || chatStore.isLoadingSessions || chatStore.isLoadingMessages
))
const tabTitle = computed(() => {
  if (route.name !== 'hermes.session' && route.name !== 'desktop.chat') return productTitle
  return chatStore.activeSession?.title?.trim() || productTitle
})

watch(tabTitle, (value) => {
  document.title = value
}, { immediate: true })

onUnmounted(() => {
  disposed = true
  routeLoadSequence++
  document.title = productTitle
})

async function loadRouteSession() {
  const sessionId = routeSessionId.value
  await chatStore.loadSessions(chatStore.sessionProfileFilter, sessionId)
  if (!disposed && sessionId && routeSessionId.value === sessionId && chatStore.activeSessionId !== sessionId) {
    await router.replace({ name: 'hermes.chat' })
  }
}

async function applyRouteProfile() {
  const sequence = ++profileApplySequence
  const sessionId = routeSessionId.value
  const requestedProfile = routeProfile.value
  let profile = requestedProfile
  const isCurrent = () => !disposed && sequence === profileApplySequence
    && routeSessionId.value === sessionId && routeProfile.value === requestedProfile
  // Older links contain only a session ID. Resolve its owner before applying
  // the visible Bot filter; the selected Bot must never determine ownership.
  if (sessionId && !profile) {
    const cached = chatStore.sessions.find(session => session.id === sessionId)
    const context = cached || await fetchSessionContext(sessionId)
    if (!isCurrent()) return false
    if (context) profile = context.profile || 'default'
  }
  profile ||= botWorkspace.value ? profilesStore.activeProfileName : null
  if (!profile) return true
  if (profile === profilesStore.activeProfileName) {
    if (botWorkspace.value || sessionId) chatStore.setSessionProfileFilter(profile)
    return true
  }
  if (!profilesStore.profiles.some(item => item.name === profile)) return true
  await profilesStore.switchProfile(profile)
  if (!isCurrent() || profilesStore.activeProfileName !== profile) return false
  chatStore.setSessionProfileFilter(profile)
  return true
}

onMounted(async () => {
  chatStore.setRuntimeMode('default')
  const models = appStore.loadModels()
  // 先加载 profile，确保缓存 key 使用正确的 profile name；同时预取显示设置，
  // 让聊天完成提示音不依赖用户先打开 Settings 页面。
  try {
    await Promise.all([
      profilesStore.fetchProfiles(),
      settingsStore.fetchSettings(),
    ])
    if (disposed) return
    chatStore.validateSessionProfileFilter(profilesStore.profiles.map(profile => profile.name))
    do {
      const target = [routeSessionId.value, routeProfile.value].join(':')
      const applied = await applyRouteProfile()
      if (disposed) return
      if (!applied) continue
      await Promise.all([models, loadRouteSession()])
      if (target === [routeSessionId.value, routeProfile.value].join(':')) break
    } while (!disposed)
  } catch (error) {
    console.error('Failed to initialize chat page:', error)
  } finally {
    initializing.value = false
  }
})

watch([routeSessionId, routeProfile], async ([sessionId]) => {
  if (initializing.value || !chatStore.sessionsLoaded) return
  const sequence = ++routeLoadSequence
  routeLoading.value = true
  try {
    const applied = await applyRouteProfile()
    if (!applied || disposed || sequence !== routeLoadSequence) return
    if (!sessionId) {
      await chatStore.loadSessions(chatStore.sessionProfileFilter)
      return
    }
    if (chatStore.activeSessionId === sessionId) return

    const exists = chatStore.sessions.some(session => session.id === sessionId)
    if (!exists) {
      await loadRouteSession()
      return
    }

    await chatStore.switchSession(sessionId)
  } catch (error) {
    console.error('Failed to switch chat page:', error)
  } finally {
    if (sequence === routeLoadSequence) routeLoading.value = false
  }
})
</script>

<template>
  <PageLoading :show="pageLoading" :initial-only="contentMode === 'chat'" class="chat-view" :class="{ 'chat-view--standalone': isStandaloneChat }">
    <ChatPanel
      :standalone="isStandaloneChat"
      :bot-workspace="botWorkspace"
      :content-mode="contentMode"
    />
  </PageLoading>
</template>

<style scoped lang="scss">
.chat-view {
  height: 100%;
  display: flex;
  flex-direction: column;

  &--standalone {
    height: 100%;
  }
}
</style>
