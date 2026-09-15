// Heavy-CPU offload — the main-thread API over workers/heavy.mjs.
//
// Every function here used to run synchronously on the request thread. A
// 20MB Excel parse or a 200MB RAR unpack blocked the event loop for seconds
// and EVERY user's request queued behind it (the "hang"). Now:
//
//   • a small pool of worker threads (1–2) takes the CPU work; the request
//     thread only awaits a message,
//   • one job at a time per worker, FIFO queue, per-job timeout,
//   • a crashed worker is replaced; a job that dies is rejected, never lost
//     silently,
//   • if the worker file can't be found (unexpected deploy layout) every call
//     falls back to the in-process implementation — slower, never broken.
//
// Input buffers are structured-cloned (copied) to the worker so the caller's
// Buffer stays usable; results come back zero-copy (transferred).

import path from 'path'
import fs from 'fs'
import os from 'os'
import { createRequire } from 'module'
import type { Worker } from 'worker_threads'

// worker_threads is fetched at runtime, NOT imported: the bundler traces every
// `new Worker(...)` it can see, bundles the worker file and its wasm loader,
// and the build breaks. Loaded like this, the worker stays a plain file on disk.
type WorkerCtor = new (file: string) => Worker
function workerCtor(): WorkerCtor {
  const viaBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => { Worker: WorkerCtor } }).getBuiltinModule?.('worker_threads')
  if (viaBuiltin?.Worker) return viaBuiltin.Worker
  const req = createRequire(path.join(process.cwd(), 'package.json'))
  return (req('worker_threads') as { Worker: WorkerCtor }).Worker
}

const WORKER_FILE = path.join(process.cwd(), process.env.HEAVY_WORKER_DIR || 'workers', 'heavy.mjs')
const POOL_SIZE = Math.max(1, Math.min(2, (os.cpus()?.length || 2) - 1))
const JOB_TIMEOUT_MS = 180_000
const IDLE_EXIT_MS = 5 * 60_000

type Job = {
  op: string
  buf: Uint8Array
  opts: Record<string, unknown>
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer?: NodeJS.Timeout
}

type Slot = { worker: Worker; busy: Job | null; idleTimer: NodeJS.Timeout | null }

const slots: Slot[] = []
const queue: Job[] = []
let seq = 0
const inflight = new Map<number, { slot: Slot; job: Job }>()

function workerAvailable(): boolean {
  try { return fs.existsSync(WORKER_FILE) } catch { return false }
}

function spawn(): Slot {
  const Ctor = workerCtor()
  const worker = new Ctor(WORKER_FILE)
  worker.unref() // never keep the process alive on its own (tests, shutdown)
  const slot: Slot = { worker, busy: null, idleTimer: null }
  worker.on('message', (m: { id: number; ok: boolean; result?: unknown; error?: string }) => {
    const rec = inflight.get(m.id)
    if (!rec) return
    inflight.delete(m.id)
    if (rec.job.timer) clearTimeout(rec.job.timer)
    rec.slot.busy = null
    rec.slot.worker.unref() // idle again: never keep the process alive by itself
    if (m.ok) rec.job.resolve(m.result)
    else rec.job.reject(new Error(m.error || 'worker error'))
    pump()
  })
  const die = (why: string) => {
    const i = slots.indexOf(slot)
    if (i >= 0) slots.splice(i, 1)
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    for (const [id, rec] of inflight) {
      if (rec.slot !== slot) continue
      inflight.delete(id)
      if (rec.job.timer) clearTimeout(rec.job.timer)
      rec.job.reject(new Error(`heavy worker ${why}`))
    }
    pump()
  }
  worker.on('error', (e) => die(`crashed: ${e.message}`))
  worker.on('exit', (code) => { if (code !== 0) die(`exited (${code})`); else { const i = slots.indexOf(slot); if (i >= 0) slots.splice(i, 1) } })
  slots.push(slot)
  return slot
}

function pump() {
  while (queue.length > 0) {
    let slot = slots.find((s) => !s.busy)
    if (!slot && slots.length < POOL_SIZE) slot = spawn()
    if (!slot) return
    const job = queue.shift()!
    slot.busy = job
    if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = null }
    const id = ++seq
    inflight.set(id, { slot, job })
    job.timer = setTimeout(() => {
      // A stuck job poisons the worker — replace it rather than wait forever.
      inflight.delete(id)
      job.reject(new Error(`heavy job ${job.op} timed out`))
      void slot!.worker.terminate()
    }, JOB_TIMEOUT_MS)
    slot.worker.ref() // a job is in flight — the event loop must wait for it
    slot.worker.postMessage({ id, op: job.op, buf: job.buf, opts: job.opts })
  }
  // Idle workers go away after a while so a quiet server holds no extra memory.
  for (const s of slots) {
    if (!s.busy && !s.idleTimer) {
      s.idleTimer = setTimeout(() => { const i = slots.indexOf(s); if (i >= 0) slots.splice(i, 1); void s.worker.terminate() }, IDLE_EXIT_MS)
      s.idleTimer.unref()
    }
  }
}

function run<T>(op: string, buf: Uint8Array, opts: Record<string, unknown> = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ op, buf, opts, resolve: resolve as (v: unknown) => void, reject })
    pump()
  })
}

// ─── in-process fallbacks (identical semantics, main thread) ────────────────

async function fallback<T>(op: string, buf: Uint8Array, opts: Record<string, unknown>): Promise<T> {
  const { createHash } = await import('crypto')
  const toBuf = (u8: Uint8Array) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)
  const junk = (p: string) => {
    const base = p.split('/').pop() || ''
    return p.endsWith('/') || /(^|\/)__MACOSX\//.test(p) || base.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(base) || /\.(bak|tmp|log|lnk|ini|db)$/i.test(base) || base === ''
  }
  switch (op) {
    case 'sha256': return createHash('sha256').update(toBuf(buf)).digest('hex') as T
    case 'unzip': {
      const { unzipSync } = await import('fflate')
      const cap = Number(opts.entryCap ?? Infinity)
      const files = unzipSync(buf, { filter: (f) => !junk(f.name) && f.originalSize <= cap })
      return { entries: Object.entries(files).filter(([p, d]) => !junk(p) && d.length > 0).map(([p, d]) => ({ path: p, data: d })) } as T
    }
    case 'xlsxSheets': {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(toBuf(buf), { type: 'buffer' })
      const cap = Number(opts.csvCap ?? Infinity)
      return { sheets: wb.SheetNames.map((name) => ({ name, csv: XLSX.utils.sheet_to_csv(wb.Sheets[name], { strip: true, blankrows: false }).slice(0, cap) })) } as T
    }
    case 'pdfText': {
      try {
        const { extractText, getDocumentProxy } = await import('unpdf')
        const pdf = await getDocumentProxy(new Uint8Array(buf))
        const { text } = await extractText(pdf, { mergePages: false })
        return { pages: Array.isArray(text) ? text.map((p) => String(p || '')) : [String(text || '')] } as T
      } catch { return { pages: null } as T }
    }
    case 'pdfPageCount': {
      try {
        const { PDFDocument } = await import('pdf-lib')
        return (await PDFDocument.load(toBuf(buf), { ignoreEncryption: true, updateMetadata: false })).getPageCount() as T
      } catch { return 0 as T }
    }
    case 'pdfPageRange': {
      const { PDFDocument } = await import('pdf-lib')
      const src = await PDFDocument.load(toBuf(buf), { ignoreEncryption: true, updateMetadata: false })
      const out = await PDFDocument.create()
      const count = src.getPageCount()
      const a = Math.min(Math.max(1, Number(opts.from)), count) - 1
      const b = Math.min(Math.max(Number(opts.from), Number(opts.to)), count) - 1
      const copied = await out.copyPages(src, Array.from({ length: b - a + 1 }, (_, i) => a + i))
      for (const p of copied) out.addPage(p)
      return (await out.save()) as T
    }
    case 'rarExtract':
      // RAR lives ONLY in the worker: the unrar package ships a wasm loader the
      // bundler must never see (bundling it breaks the build). The worker file is
      // part of every deploy (Dockerfile copies it), so this is a real fault.
      throw new Error('فك ملفات RAR يحتاج عامل المعالجة (workers/heavy.mjs) — غير متاح على هذا الخادم')
    default: throw new Error(`unknown heavy op ${op}`)
  }
}

let useWorkers: boolean | null = null
async function call<T>(op: string, buf: Uint8Array, opts: Record<string, unknown> = {}): Promise<T> {
  if (useWorkers === null) useWorkers = workerAvailable()
  if (!useWorkers) return fallback<T>(op, buf, opts)
  try {
    return await run<T>(op, buf, opts)
  } catch (e) {
    // Worker infrastructure failure (not a content error) → do it here rather
    // than fail the user's request. Content errors are thrown by both paths.
    if (e instanceof Error && /heavy worker|timed out|Cannot find module|ERR_/.test(e.message)) return fallback<T>(op, buf, opts)
    throw e
  }
}

// ─── public API ─────────────────────────────────────────────────────────────

export interface ZipEntry { path: string; data: Uint8Array }
export interface RarResult { encrypted: boolean; entries: ZipEntry[]; skipped: Array<{ path: string; why: 'entry-cap' | 'total-cap' | 'max-entries' }> }

export const heavy = {
  sha256: (buf: Uint8Array) => call<string>('sha256', buf),
  unzip: (buf: Uint8Array, entryCap?: number) => call<{ entries: ZipEntry[] }>('unzip', buf, entryCap ? { entryCap } : {}),
  xlsxSheets: (buf: Uint8Array, csvCap?: number) => call<{ sheets: Array<{ name: string; csv: string }> }>('xlsxSheets', buf, csvCap ? { csvCap } : {}),
  pdfText: (buf: Uint8Array) => call<{ pages: string[] | null }>('pdfText', buf),
  pdfPageCount: (buf: Uint8Array) => call<number>('pdfPageCount', buf),
  pdfPageRange: (buf: Uint8Array, from: number, to: number) => call<Uint8Array>('pdfPageRange', buf, { from, to }),
  rarExtract: (buf: Uint8Array, caps: { entryCap?: number; totalCap?: number; maxEntries?: number } = {}) => call<RarResult>('rarExtract', buf, caps),
}
