// What each upload `kind` is allowed to contain.
//
// SHARED by both upload paths — the classic POST (/api/upload) and the presigned
// direct-to-S3 path (/api/upload/presign). Keeping one copy is the point: the
// presigned URL lets the browser write to the bucket, so its policy must never
// drift from (or be laxer than) the one the server-side route enforces.

export type KindPolicy = {
  mimePrefixes: string[]
  superAdminOnly?: boolean
}

export const KIND_POLICY: Record<string, KindPolicy> = {
  avatars:        { mimePrefixes: ['image/'] },
  posts:          { mimePrefixes: ['image/', 'video/'] },
  stories:        { mimePrefixes: ['image/', 'video/'] },
  chat:           { mimePrefixes: ['image/', 'video/', 'application/pdf'] },
  rewards:        { mimePrefixes: ['image/'] },
  goals:          { mimePrefixes: ['image/'] },
  doodles:        { mimePrefixes: ['image/'] },
  // Furn — BOQ Excel + spec/drawing PDFs / Word files.
  furn:           { mimePrefixes: ['application/', 'image/', 'text/'] },
  // Furn branding (header image + signature). Locked to super-admin.
  furn_branding:  { mimePrefixes: ['image/'], superAdminOnly: true },
  // Client projects — BOQs, contracts, drawings, photos.
  projects:       { mimePrefixes: ['application/', 'image/', 'text/'] },
  // Important Documents (Pre-qualification source documents).
  documents:      { mimePrefixes: ['application/', 'image/'] },
  // Pre-qualification rendered output (the merged packet).
  prequal:        { mimePrefixes: ['application/pdf'] },
  // Pre-qualification cover/back templates (PDF or image).
  prequal_template: { mimePrefixes: ['application/pdf', 'image/'] },
  // Tannoor — BOQ Excel + spec/drawing files.
  tannoor:        { mimePrefixes: ['application/', 'image/', 'text/'] },
  // Tannoor product photos.
  tannoor_products: { mimePrefixes: ['image/'] },
  // Magic-tunnel scene photos.
  visualize:      { mimePrefixes: ['image/'] },
  // The company profile attached to every outreach email. Super-admin only —
  // it is mailed to third parties under the company's name.
  outreach:       { mimePrefixes: ['application/pdf'], superAdminOnly: true },
}

export function policyFor(kind: string): KindPolicy | null {
  return KIND_POLICY[kind] ?? null
}

export function mimeAllowed(policy: KindPolicy, mime: string): boolean {
  return policy.mimePrefixes.some((p) => (mime || '').startsWith(p))
}
