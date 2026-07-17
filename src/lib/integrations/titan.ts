// Titan email (titan.email) IMAP credentials — the inbox we pull customer
// projects from.
//
// TITAN HAS NO REST API. It is a mailbox host; the only programmatic way in is
// IMAP (imap.titan.email:993, SSL). So there is no "API key" to store — we store
// the mailbox login and connect over IMAP. The password is a real secret and is
// AES-256-GCM encrypted at rest, exactly like the OpenAI key.
//
// Prerequisites the owner must set ON THE TITAN SIDE (we can't do these for him):
//   1. Enable "third-party access" in Titan account settings.
//   2. Disable two-factor auth — Titan blocks IMAP apps while 2FA is on.
// Both are surfaced in the settings UI so he isn't left guessing.
//
// STORAGE: S3 (`app-data/integrations.json`), no DB column — same hard
// constraint as everything else here.

import { readJson, writeJson } from '@/lib/s3'
import { encryptSecret, decryptSecret, isEncrypted } from '@/lib/encryption'

const KEY = 'app-data/integrations.json'

// Titan's published IMAP endpoint. Kept configurable in case a mailbox is on the
// EU host, but defaulted so the owner only has to type email + password.
const DEFAULT_HOST = 'imap.titan.email'
const DEFAULT_PORT = 993

export interface TitanSettings {
  enabled: boolean
  host: string
  port: number
  email: string
  /** AES-256-GCM envelope, server-only. Never sent to the browser. */
  password: string | null
  /** Which IMAP mailbox to read. */
  folder: string
  updatedAt: string
  updatedBy: string | null
}

// Browser-safe projection — the password becomes a boolean, exactly like
// AiSettingsPublic's has_openai_key.
export interface TitanSettingsPublic {
  enabled: boolean
  host: string
  port: number
  email: string
  has_password: boolean
  folder: string
  updatedAt: string
  updatedBy: string | null
}

interface IntegrationsBlob {
  titan?: Partial<TitanSettings>
}

const DEFAULT_TITAN: TitanSettings = {
  enabled: false,
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  email: '',
  password: null,
  folder: 'INBOX',
  updatedAt: '',
  updatedBy: null,
}

async function readBlob(): Promise<IntegrationsBlob> {
  return (await readJson<IntegrationsBlob | null>(KEY, null)) ?? {}
}

function normalize(t: Partial<TitanSettings> | undefined): TitanSettings {
  return {
    enabled: !!t?.enabled,
    host: (typeof t?.host === 'string' && t.host.trim()) || DEFAULT_HOST,
    port: Number.isFinite(Number(t?.port)) && Number(t?.port) > 0 ? Number(t?.port) : DEFAULT_PORT,
    email: typeof t?.email === 'string' ? t.email.trim() : '',
    password: typeof t?.password === 'string' ? t.password : null,
    folder: (typeof t?.folder === 'string' && t.folder.trim()) || 'INBOX',
    updatedAt: typeof t?.updatedAt === 'string' ? t.updatedAt : '',
    updatedBy: typeof t?.updatedBy === 'string' ? t.updatedBy : null,
  }
}

/** Full settings incl. the encrypted password envelope — SERVER ONLY. */
export async function getTitanSettings(): Promise<TitanSettings> {
  const blob = await readBlob()
  return normalize(blob.titan)
}

/** Browser-safe view — password reduced to a boolean. */
export function toPublicTitan(t: TitanSettings): TitanSettingsPublic {
  return {
    enabled: t.enabled,
    host: t.host,
    port: t.port,
    email: t.email,
    has_password: !!t.password,
    folder: t.folder,
    updatedAt: t.updatedAt,
    updatedBy: t.updatedBy,
  }
}

/** The decrypted password for the IMAP client. Returns null if unset/tampered. */
export function decryptTitanPassword(t: TitanSettings): string | null {
  if (!t.password) return null
  try {
    return isEncrypted(t.password) ? decryptSecret(t.password) : t.password
  } catch {
    return null
  }
}

export interface TitanPatch {
  enabled?: boolean
  host?: string
  port?: number
  email?: string
  /** Plaintext new password. '' clears it. undefined leaves it unchanged. */
  password?: string
  folder?: string
  updatedBy?: string | null
}

export async function setTitanSettings(patch: TitanPatch): Promise<TitanSettings> {
  const blob = await readBlob()
  const current = normalize(blob.titan)

  const next: TitanSettings = {
    enabled: patch.enabled ?? current.enabled,
    host: patch.host !== undefined ? (patch.host.trim() || DEFAULT_HOST) : current.host,
    port: patch.port !== undefined && Number.isFinite(patch.port) && patch.port > 0 ? patch.port : current.port,
    email: patch.email !== undefined ? patch.email.trim() : current.email,
    // Non-empty → encrypt; '' → clear; undefined → keep. Same semantics as the
    // OpenAI key so admins get consistent "saved / remove" behaviour.
    password:
      patch.password === undefined
        ? current.password
        : patch.password
          ? encryptSecret(patch.password)
          : null,
    folder: patch.folder !== undefined ? (patch.folder.trim() || 'INBOX') : current.folder,
    updatedAt: new Date().toISOString(),
    updatedBy: patch.updatedBy ?? current.updatedBy,
  }

  await writeJson(KEY, { ...blob, titan: next })
  return next
}
