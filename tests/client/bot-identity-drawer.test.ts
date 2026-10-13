// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import BotIdentityDrawer from '@/components/hermes/workspace/BotIdentityDrawer.vue'
import en from '@/i18n/locales/en'

const store = vi.hoisted(() => ({
  activeProfileName: 'a', profiles: [], updateIdentity: vi.fn(), updateAvatar: vi.fn(), deleteAvatar: vi.fn(), createBot: vi.fn(),
}))
vi.mock('@/stores/hermes/profiles', () => ({ useProfilesStore: () => store }))
vi.mock('@/api/hermes/system', () => ({ fetchAvailableModelsForProfile: vi.fn(async () => ({ groups: [] })) }))
vi.mock('naive-ui', () => ({
  useMessage: () => ({ error: vi.fn(), success: vi.fn() }),
  NDrawer: { props: ['show'], template: '<div v-if="show"><slot /></div>' },
  NDrawerContent: { template: '<div><slot /><slot name="footer" /></div>' },
  NButton: { props: ['disabled', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
  NInput: { props: ['value'], template: '<input :value="value" />' },
  NSelect: { template: '<select />' },
}))
vi.mock('@/components/hermes/profiles/ProfileAvatar.vue', () => ({
  default: { props: ['avatar'], template: '<img class="avatar-preview" :src="avatar?.dataUrl || \'default\'" />' },
}))

const readers: DeferredReader[] = []
class DeferredReader {
  result = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { readers.push(this) }
  readAsDataURL() {}
  finish(data: string) { this.result = data; this.onload?.() }
}
const profile = (name: string) => ({ name, displayName: name.toUpperCase(), model: '', alias: '', active: true, avatar: { type: 'image' as const, dataUrl: `data:image/png;base64,${name}` } })
function createDrawer() {
  return mount(BotIdentityDrawer, { props: { show: true, profile: profile('a') }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] } })
}
async function upload(wrapper: ReturnType<typeof createDrawer>) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['avatar'], 'avatar.png', { type: 'image/png' })], configurable: true })
  await input.trigger('change')
}
function saveButton(wrapper: ReturnType<typeof createDrawer>) { return wrapper.findAll('button').find(button => button.text() === 'Save')! }

describe('Bot identity avatar read isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); readers.length = 0; vi.stubGlobal('FileReader', DeferredReader) })
  afterEach(() => vi.unstubAllGlobals())

  it('disables saving until the selected avatar finishes reading', async () => {
    const wrapper = createDrawer()
    await upload(wrapper)
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(store.updateIdentity).not.toHaveBeenCalled()
    readers[0].finish('data:image/png;base64,uploaded')
    await flushPromises()
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(store.updateAvatar).toHaveBeenCalledWith('a', { type: 'image', dataUrl: 'data:image/png;base64,uploaded' })
    wrapper.unmount()
  })

  it('ignores a late read after cancellation and opening another Bot', async () => {
    const wrapper = createDrawer()
    await upload(wrapper)
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true, profile: profile('b') })
    readers[0].finish('data:image/png;base64,from-a')
    await flushPromises()
    expect(wrapper.get('.avatar-preview').attributes('src')).toBe('data:image/png;base64,b')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(store.updateIdentity).toHaveBeenCalledWith('b', { displayName: 'B', description: '' })
    expect(store.updateAvatar).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps restore default after an earlier upload finishes late', async () => {
    const wrapper = createDrawer()
    await upload(wrapper)
    await wrapper.get('.text-button').trigger('click')
    readers[0].finish('data:image/png;base64,discarded')
    await flushPromises()
    expect(wrapper.get('.avatar-preview').attributes('src')).toBe('default')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(store.deleteAvatar).toHaveBeenCalledWith('a')
    expect(store.updateAvatar).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps the newest upload when reads finish out of order', async () => {
    const wrapper = createDrawer()
    await upload(wrapper)
    await upload(wrapper)
    readers[1].finish('data:image/png;base64,newer')
    readers[0].finish('data:image/png;base64,older')
    await flushPromises()
    expect(wrapper.get('.avatar-preview').attributes('src')).toBe('data:image/png;base64,newer')
    wrapper.unmount()
  })
})
