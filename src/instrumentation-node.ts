// Node-only process guards. Imported dynamically from instrumentation.ts so
// the Edge bundle never sees `process.on`.
export function registerNodeGuards() {
  process.on('unhandledRejection', (reason) => {
    console.error('[instrumentation] unhandledRejection:', reason)
  })

  process.on('uncaughtException', (err) => {
    console.error('[instrumentation] uncaughtException:', err)
  })
}
