// Runs once at server startup. On Node, installs process-level guards so a
// single stray async error can't kill the worker — a rejected promise from a
// background task (Supabase realtime, fire-and-forget logging, etc.) would
// otherwise crash the process and nginx would 502 every user until PM2 revives
// it. The Node-specific code lives in a separate module loaded via dynamic
// import so the Edge bundle never statically references `process.on`.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeGuards } = await import('./instrumentation-node')
    registerNodeGuards()
  }
}
