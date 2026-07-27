// The client's email address per project — the recipient for a direct send.
//
// Stored in S3 (no DB column, same constraint as everywhere). Auto-filled from
// the inbox sender when a project is converted from an email; entered by hand on
// a manually-created project. Keyed by client_project id.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/project-emails.json'

type Store = Record<string, string> // clientProjectId → email

export async function getProjectEmail(projectId: string): Promise<string> {
  return (await readJson<Store>(KEY, {}))[projectId] || ''
}

export async function setProjectEmail(projectId: string, email: string): Promise<void> {
  const store = await readJson<Store>(KEY, {})
  const e = (email || '').trim()
  if (e) store[projectId] = e
  else delete store[projectId]
  await writeJson(KEY, store)
}
