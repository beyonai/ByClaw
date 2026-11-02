/** A disconnected Playwright client can leave launchServer.close pending indefinitely.
 * Bound graceful shutdown, then kill only the BrowserServer owned by this driver.
 */
export async function closeOwnedBrowserServer(server: { close(): Promise<void>; kill(): Promise<void> }, graceMs = 3000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const closed = await Promise.race([
      server.close().then(() => true, () => false),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), graceMs) }),
    ])
    if (!closed) await server.kill()
  } finally { if (timer) clearTimeout(timer) }
}
