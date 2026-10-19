/**
 * Host clipboard write, self-contained so the plugin never depends on a
 * ui-primitives value export (the pinned build harness does not export the
 * helper, and rc.6 keeps only this one — replicating it keeps the copy button
 * identical across every dsh version). Success feedback stays with the caller;
 * this helper only reports whether the host accepted a write.
 *
 * @param text - the exact text to place on the clipboard.
 * @returns true only when the host accepted the write.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  // lib.dom types clipboard non-optional, but insecure contexts omit it —
  // that runtime gap is exactly what this guard detects.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Denied permissions / iframe policy — do not claim success.
      return false
    }
  }
  // jsdom and older hosts: best-effort execCommand path when present.
  const exec = typeof document.execCommand === 'function'
    ? document.execCommand.bind(document)
    : undefined
  if (exec === undefined) return false
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  el.select()
  try {
    return exec('copy')
  } catch {
    return false
  } finally {
    el.remove()
  }
}
