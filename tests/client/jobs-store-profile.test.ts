// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const state = vi.hoisted(() => ({ profile: 'default' }))
const listJobs = vi.hoisted(() => vi.fn())
const pauseJob = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', () => ({ getActiveProfileName: () => state.profile }))
vi.mock('@/api/hermes/jobs', () => ({ listJobs, pauseJob }))

import { useJobsStore } from '@/stores/hermes/jobs'

describe('scheduled jobs Profile isolation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    state.profile = 'default'
  })

  it('ignores an old Bot list after loading the selected Bot', async () => {
    const store = useJobsStore()
    let release!: (value: unknown[]) => void
    listJobs.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const oldLoad = store.fetchJobs()
    state.profile = 'research'
    store.resetProfile()
    listJobs.mockResolvedValueOnce([{ id: 'shared-id', name: 'Research task' }])
    await store.fetchJobs()
    release([{ id: 'shared-id', name: 'Default task' }])
    await oldLoad
    expect(store.jobs.map(job => job.name)).toEqual(['Research task'])
    expect(store.loading).toBe(false)
  })

  it('does not commit a completed old Bot action into the new Bot with the same job ID', async () => {
    const store = useJobsStore()
    let release!: (value: unknown) => void
    pauseJob.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const pending = store.pauseJob('shared-id')
    state.profile = 'research'
    store.resetProfile()
    listJobs.mockResolvedValueOnce([{ id: 'shared-id', name: 'Research task', enabled: true }])
    await store.fetchJobs()
    release({ id: 'shared-id', name: 'Default task', enabled: false })
    await pending
    expect(store.jobs[0]).toMatchObject({ name: 'Research task', enabled: true })
  })

  it('invalidates a pending list when leaving the jobs page', async () => {
    const store = useJobsStore()
    let release!: (value: unknown[]) => void
    listJobs.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const pending = store.fetchJobs()
    store.resetProfile()
    release([{ id: 'late', name: 'Late task' }])
    await pending
    expect(store.jobs).toEqual([])
    expect(store.loading).toBe(false)
  })
})
