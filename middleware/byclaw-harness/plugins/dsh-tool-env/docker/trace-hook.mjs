// Node module-customization hook: append every resolved file path to $TRACE_OUT.
import { appendFileSync } from 'node:fs'
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context)
  if (resolved.url?.startsWith('file://')) appendFileSync(process.env.TRACE_OUT, `${resolved.url.slice(7)}\n`)
  return resolved
}
