<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDrawer, NDrawerContent, NInput, NSelect, useMessage } from 'naive-ui'
import type { HermesProfile, ProfileAvatar } from '@/api/hermes/profiles'
import { fetchAvailableModelsForProfile, type AvailableModelGroup } from '@/api/hermes/system'
import { useProfilesStore } from '@/stores/hermes/profiles'
import ProfileAvatarView from '@/components/hermes/profiles/ProfileAvatar.vue'
import { botDisplayName } from '@/utils/bot-workspace'

const props = defineProps<{ show: boolean; profile?: HermesProfile | null }>()
const emit = defineEmits<{ 'update:show': [boolean]; created: [string] }>()
const { t } = useI18n()
const store = useProfilesStore()
const message = useMessage()
const displayName = ref('')
const description = ref('')
const avatar = ref<ProfileAvatar | null>(null)
const avatarChanged = ref(false)
const readingAvatar = ref(false)
const saving = ref(false)
const createdName = ref<string | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const sourceProfile = ref<string | null>(null)
const connection = ref<string | null>(null)
const modelGroups = ref<AvailableModelGroup[]>([])
const loadingModels = ref(false)
let modelRequest = 0
let avatarReadRequest = 0
const creating = computed(() => !props.profile)
const connectionOptions = computed(() => modelGroups.value.flatMap(group => group.models.map(model => ({
  label: `${model} · ${group.label || group.provider}`,
  value: JSON.stringify({ provider: group.provider, model }),
}))))
const sourceOptions = computed(() => store.profiles.map(profile => ({ label: botDisplayName(profile), value: profile.name })))
watch([() => props.show, () => props.profile?.name], ([show]) => {
  avatarReadRequest++
  modelRequest++
  readingAvatar.value = false
  loadingModels.value = false
  if (!show) return
  displayName.value = props.profile?.displayName || props.profile?.name || ''
  createdName.value = null
  description.value = props.profile?.description || ''
  avatar.value = props.profile?.avatar || null
  avatarChanged.value = false
  sourceProfile.value = creating.value ? store.activeProfileName : null
  connection.value = null
  modelGroups.value = []
  if (creating.value && sourceProfile.value) void loadConnections(sourceProfile.value)
}, { immediate: true })
onBeforeUnmount(() => { avatarReadRequest++; modelRequest++ })
async function loadConnections(profile: string | null) {
  const request = ++modelRequest
  connection.value = null
  modelGroups.value = []
  if (!profile) { loadingModels.value = false; return }
  loadingModels.value = true
  try {
    const result = await fetchAvailableModelsForProfile(profile)
    if (request !== modelRequest) return
    modelGroups.value = result.groups
    const preferred = store.profiles.find(item => item.name === profile)?.model
    const group = result.groups.find(item => item.models.includes(preferred || ''))
    if (group && preferred) connection.value = JSON.stringify({ provider: group.provider, model: preferred })
    else connection.value = connectionOptions.value[0]?.value || null
  } catch { if (request === modelRequest) message.error(t('botWorkspace.connectionLoadFailed')) }
  finally { if (request === modelRequest) loadingModels.value = false }
}
function changeSource(profile: string | null) { sourceProfile.value = profile; void loadConnections(profile) }
async function pickAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {
    message.error(t('botWorkspace.avatarHint')); return
  }
  const request = ++avatarReadRequest
  readingAvatar.value = true
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    if (request !== avatarReadRequest || !props.show) return
    avatar.value = { type: 'image', dataUrl }
    avatarChanged.value = true
  } catch { if (request === avatarReadRequest) message.error(t('botWorkspace.saveFailed')) }
  finally { if (request === avatarReadRequest) readingAvatar.value = false }
}
function resetAvatar() { avatarReadRequest++; readingAvatar.value = false; avatar.value = null; avatarChanged.value = true }
async function save() {
  if (saving.value || readingAvatar.value || !displayName.value.trim()) return
  saving.value = true
  try {
    let name = props.profile?.name || createdName.value
    if (!name) {
      const selected = connection.value ? JSON.parse(connection.value) as { provider: string; model: string } : null
      const result = await store.createBot({
        displayName: displayName.value.trim(), description: description.value.trim(),
        ...(sourceProfile.value && selected ? { sourceConnection: { profile: sourceProfile.value, ...selected } } : {}),
      })
      if (!result.success || !result.name) throw new Error(result.error || t('botWorkspace.saveFailed'))
      name = result.name
      createdName.value = name
      // A created profile remains editable if its separate avatar upload fails.
      if (avatarChanged.value && avatar.value) await store.updateAvatar(name, avatar.value)
    } else {
      await store.updateIdentity(name, { displayName: displayName.value.trim(), description: description.value.trim() })
      if (avatarChanged.value) {
        if (avatar.value) await store.updateAvatar(name, avatar.value)
        else await store.deleteAvatar(name)
      }
    }
    if (createdName.value) emit('created', createdName.value)
    emit('update:show', false)
    message.success(t('botWorkspace.saved'))
  } catch (error) { message.error(error instanceof Error ? error.message : t('botWorkspace.saveFailed')) }
  finally { saving.value = false }
}
</script>

<template>
  <NDrawer :show="show" :width="'min(400px, 100vw)'" :auto-focus="true" :mask-closable="!saving" :close-on-esc="!saving" @update:show="emit('update:show', $event)">
    <NDrawerContent :title="t(creating ? 'botWorkspace.createBot' : 'botWorkspace.editBot')" :closable="!saving">
      <form class="bot-identity" @submit.prevent="save">
        <div class="bot-identity__avatar">
          <ProfileAvatarView :name="profile?.name || displayName || 'new-bot'" :avatar="avatar" :size="88" />
          <div><NButton size="small" :disabled="saving" @click="uploadInput?.click()">{{ t('botWorkspace.uploadAvatar') }}</NButton>
            <button type="button" class="text-button" :disabled="saving" @click="resetAvatar">{{ t('botWorkspace.restoreAvatar') }}</button>
          </div>
          <input ref="uploadInput" class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" @change="pickAvatar">
        </div>
        <p class="field-help">{{ t('botWorkspace.avatarHint') }}</p>
        <label class="bot-field"><span>{{ t('botWorkspace.displayName') }}</span><NInput v-model:value="displayName" :input-props="{ 'aria-label': t('botWorkspace.displayName') }" :maxlength="80" :disabled="saving" :placeholder="profile?.name || t('botWorkspace.namePlaceholder')" /></label>
        <label class="bot-field"><span>{{ t('botWorkspace.description') }}</span><NInput v-model:value="description" :input-props="{ 'aria-label': t('botWorkspace.description') }" type="textarea" :maxlength="280" :autosize="{ minRows: 3, maxRows: 5 }" :disabled="saving" :placeholder="t('botWorkspace.descriptionPlaceholder')" /><small>{{ t('botWorkspace.descriptionHint') }}</small></label>
        <div v-if="profile" class="bot-internal-id"><span>{{ t('botWorkspace.internalId') }}</span><code>{{ profile.name }}</code><p>{{ t('botWorkspace.internalIdHint') }}</p></div>
        <template v-else>
          <label class="bot-field"><span>{{ t('botWorkspace.connectionSource') }}</span><NSelect :value="sourceProfile" :options="sourceOptions" clearable :disabled="saving" :placeholder="t('botWorkspace.connectLater')" @update:value="changeSource" /></label>
          <label v-if="sourceProfile" class="bot-field"><span>{{ t('botWorkspace.modelConnection') }}</span><NSelect v-model:value="connection" :options="connectionOptions" :loading="loadingModels" :disabled="saving || loadingModels" clearable filterable :placeholder="t('botWorkspace.connectLater')" /></label>
          <p class="creation-note">{{ t('botWorkspace.createHint') }}</p>
        </template>
      </form>
      <template #footer><div class="drawer-actions"><NButton :disabled="saving" @click="emit('update:show', false)">{{ t('common.cancel') }}</NButton><NButton type="primary" :loading="saving || readingAvatar" :disabled="!displayName.trim() || loadingModels || readingAvatar" @click="save">{{ t(creating ? 'botWorkspace.createBot' : 'common.save') }}</NButton></div></template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped lang="scss">
.bot-identity { padding: 8px 0; }
.bot-identity__avatar { display: flex; align-items: center; gap: 24px; padding: 8px 0; }
.bot-identity__avatar > div { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.hidden-input { display: none; }
.text-button { border: 0; background: transparent; color: var(--text-secondary); padding: 0; font: inherit; font-size: 12px; cursor: pointer; }
.bot-field { display: flex; flex-direction: column; gap: 8px; margin-top: 24px; font-size: 13px; font-weight: 500; }
.bot-field small, .field-help, .creation-note, .bot-internal-id p { font-size: 12px; color: var(--text-muted); line-height: 1.7; font-weight: 400; }
.bot-internal-id { margin-top: 24px; padding: 16px; background: var(--bg-secondary); border-radius: 12px; font-size: 12px; }
.bot-internal-id code { display: block; margin-top: 8px; overflow-wrap: anywhere; }
.bot-internal-id p { margin-bottom: 0; }
.creation-note { padding: 16px; border: 1px solid var(--border-color); border-radius: 12px; margin-top: 24px; }
.drawer-actions { display: flex; gap: 8px; }
</style>
