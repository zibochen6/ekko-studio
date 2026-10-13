<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NDrawer, NDrawerContent } from 'naive-ui'
import type { HermesProfile } from '@/api/hermes/profiles'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { botDisplayName } from '@/utils/bot-workspace'
const props = defineProps<{ show: boolean; profile: HermesProfile | null }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()
const { t } = useI18n()
const router = useRouter()
const profiles = useProfilesStore()
const files = computed(() => [
  { file: 'config.yaml', key: 'config', route: 'hermes.files', query: { file: 'config.yaml' } },
  { file: '.env / auth.json', key: 'credentials', route: 'hermes.models' },
  { file: 'SOUL.md', key: 'soul', route: 'hermes.memory' },
  { file: 'memories/MEMORY.md · USER.md', key: 'memory', route: 'hermes.memory' },
  { file: 'skills/', key: 'skills', route: 'hermes.skills' },
  { file: 'cron/jobs.json', key: 'cron', route: 'hermes.jobs' },
])
async function open(file: typeof files.value[number]) {
  if (props.profile && profiles.activeProfileName !== props.profile.name) await profiles.switchProfile(props.profile.name)
  emit('update:show', false)
  void router.push({ name: file.route, query: { profile: props.profile?.name, ...(file.route === 'hermes.models' ? { modelProfile: props.profile?.name } : {}), ...file.query } })
}
</script>
<template>
  <NDrawer :show="show" :width="'min(420px, 100vw)'" @update:show="emit('update:show', $event)">
    <NDrawerContent :title="t('botWorkspace.configuration')" closable>
      <p class="config-intro">{{ t('botWorkspace.configIntro', { name: botDisplayName(profile) }) }}</p>
      <div class="config-files">
        <button v-for="file in files" :key="file.key" type="button" @click="open(file)">
          <span class="config-file-name">{{ file.file }}<span aria-hidden="true">↗</span></span>
          <strong>{{ t(`botWorkspace.files.${file.key}.title`) }}</strong>
          <span>{{ t(`botWorkspace.files.${file.key}.description`) }}</span>
        </button>
      </div>
      <p class="config-note">{{ t('botWorkspace.workspaceHint') }}</p>
    </NDrawerContent>
  </NDrawer>
</template>
<style scoped lang="scss">
.config-intro, .config-note { color: var(--text-secondary); font-size: 13px; line-height: 1.8; margin: 8px 0 24px; }
.config-files { display: flex; flex-direction: column; gap: 8px; }
.config-files button { padding: 16px; text-align: start; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-card); color: var(--text-primary); cursor: pointer; }
.config-files button:hover { background: var(--bg-secondary); }
.config-files button:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
.config-files strong { font-size: 13px; font-weight: 500; }
.config-files button > span:last-child { font-size: 12px; line-height: 1.7; color: var(--text-secondary); }
.config-file-name { display: flex; justify-content: space-between; font-family: monospace; font-size: 12px; color: var(--text-muted); }
.config-note { margin-top: 24px; }
</style>
