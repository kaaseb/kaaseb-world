// Background "النفق السحري" render jobs, persisted in S3.
//
// Why S3: the job + its result survive page navigation and a browser close —
// the render runs on the server (fire-and-forget) and writes its result here,
// so the gallery is always available and deletable.
//
// HONEST LIMIT (local dev): a render only progresses while the Node server is
// running. If the computer is turned OFF mid-render, that job can't finish — we
// mark such stuck 'processing' jobs as interrupted on read. Completed images are
// already in S3 and stay. (Deploy to a cloud server to survive a shutdown.)

import { randomUUID } from 'crypto'
import { readJson, writeJson, deleteFromS3, keyFromUrl } from '@/lib/s3'

const KEY = 'app-data/visualize-jobs.json'
const MAX_JOBS = 200
const STALE_MS = 8 * 60 * 1000 // a 'processing' job older than this = interrupted

export type VisualizeJobStatus = 'processing' | 'done' | 'failed'

export interface VisualizeJob {
  id: string
  status: VisualizeJobStatus
  mode: 'surface' | 'place'
  sceneUrl: string
  productImageUrl: string
  productName: string
  surfaces: string[]
  placementHint: string
  notes: string
  provider: string
  model: string
  quality: string
  resultUrl: string | null
  resultKey: string | null
  error: string | null
  createdBy: string
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

async function readAll(): Promise<VisualizeJob[]> {
  const list = await readJson<VisualizeJob[]>(KEY, [])
  return Array.isArray(list) ? list : []
}

async function writeAll(list: VisualizeJob[]): Promise<void> {
  await writeJson(KEY, list.slice(0, MAX_JOBS))
}

// Display-only: flag long-stuck 'processing' jobs as interrupted. Computed on
// read (NOT persisted) so the read path never races the background writer.
function markStale(list: VisualizeJob[]): VisualizeJob[] {
  const now = Date.now()
  return list.map(j =>
    j.status === 'processing' && now - new Date(j.updatedAt).getTime() > STALE_MS
      ? { ...j, status: 'failed' as const, error: j.error || 'Interrupted — the server stopped before the render finished.' }
      : j,
  )
}

export async function listJobs(): Promise<VisualizeJob[]> {
  const list = await readAll()
  return markStale(list).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function createJob(input: {
  mode: 'surface' | 'place'
  sceneUrl: string
  productImageUrl: string
  productName: string
  surfaces: string[]
  placementHint: string
  notes: string
  provider: string
  model: string
  quality: string
  createdBy: string
  createdByName: string | null
}): Promise<VisualizeJob> {
  const now = new Date().toISOString()
  const job: VisualizeJob = {
    id: randomUUID(),
    status: 'processing',
    resultUrl: null,
    resultKey: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  }
  const list = await readAll()
  list.unshift(job)
  await writeAll(list)
  return job
}

export async function updateJob(id: string, patch: Partial<VisualizeJob>): Promise<VisualizeJob | null> {
  const list = await readAll()
  const idx = list.findIndex(j => j.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() }
  await writeAll(list)
  return list[idx]
}

export async function deleteJob(id: string): Promise<boolean> {
  const list = await readAll()
  const job = list.find(j => j.id === id)
  if (!job) return false
  const key = job.resultKey || (job.resultUrl ? keyFromUrl(job.resultUrl) : null)
  if (key) { try { await deleteFromS3(key) } catch { /* best effort */ } }
  await writeAll(list.filter(j => j.id !== id))
  return true
}
