import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as jobsApi from '@/api/hermes/jobs'
import type { Job, CreateJobRequest, UpdateJobRequest } from '@/api/hermes/jobs'
import { getActiveProfileName } from '@/api/client'

function matchId(job: Job, id: string): boolean {
  return job.job_id === id || job.id === id
}

export const useJobsStore = defineStore('jobs', () => {
  const jobs = ref<Job[]>([])
  const loading = ref(false)
  let generation = 0
  let listSequence = 0

  function resetProfile() {
    generation++
    listSequence++
    jobs.value = []
    loading.value = false
  }

  function mutationContext() {
    const profile = getActiveProfileName() || 'default'
    const startedGeneration = generation
    return () => generation === startedGeneration && (getActiveProfileName() || 'default') === profile
  }

  async function fetchJobs() {
    const sequence = ++listSequence
    const isCurrent = mutationContext()
    loading.value = true
    try {
      const result = await jobsApi.listJobs()
      if (sequence === listSequence && isCurrent()) jobs.value = result
    } catch (err) {
      console.error('Failed to fetch jobs:', err)
    } finally {
      if (sequence === listSequence) loading.value = false
    }
  }

  async function createJob(data: CreateJobRequest): Promise<Job> {
    const isCurrent = mutationContext()
    const job = await jobsApi.createJob(data)
    if (isCurrent()) jobs.value.unshift(job)
    return job
  }

  async function updateJob(jobId: string, data: UpdateJobRequest): Promise<Job> {
    const isCurrent = mutationContext()
    const job = await jobsApi.updateJob(jobId, data)
    const idx = jobs.value.findIndex(j => matchId(j, jobId))
    if (isCurrent() && idx !== -1) jobs.value[idx] = job
    return job
  }

  async function deleteJob(jobId: string) {
    const isCurrent = mutationContext()
    await jobsApi.deleteJob(jobId)
    if (isCurrent()) jobs.value = jobs.value.filter(j => !matchId(j, jobId))
  }

  async function pauseJob(jobId: string) {
    const isCurrent = mutationContext()
    const job = await jobsApi.pauseJob(jobId)
    const idx = jobs.value.findIndex(j => matchId(j, jobId))
    if (isCurrent() && idx !== -1) jobs.value[idx] = job
  }

  async function resumeJob(jobId: string) {
    const isCurrent = mutationContext()
    const job = await jobsApi.resumeJob(jobId)
    const idx = jobs.value.findIndex(j => matchId(j, jobId))
    if (isCurrent() && idx !== -1) jobs.value[idx] = job
  }

  async function runJob(jobId: string) {
    const isCurrent = mutationContext()
    const job = await jobsApi.runJob(jobId)
    const idx = jobs.value.findIndex(j => matchId(j, jobId))
    if (isCurrent() && idx !== -1) jobs.value[idx] = job
  }

  return {
    jobs,
    loading,
    resetProfile,
    fetchJobs,
    createJob,
    updateJob,
    deleteJob,
    pauseJob,
    resumeJob,
    runJob,
  }
})
