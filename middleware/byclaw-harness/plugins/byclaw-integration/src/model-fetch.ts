/** Independent transport-connect and first-response deadlines for LLM requests. */

export function modelFetch(connectTimeoutMs: number | undefined, firstResponseTimeoutMs: number): typeof globalThis.fetch {
  return async (input, init = {}) => {
    // Model transport is needed on the first request, not while registering the Worker.
    const { Agent } = await import('undici')
    // A fetch resolves at response headers, not at TCP/TLS connection time.
    // Delegate connection timing to the transport instead of aborting fetch
    // while a connected model is still preparing its first response.
    const dispatcher = new Agent({
      ...(connectTimeoutMs === undefined ? {} : { connect: { timeout: connectTimeoutMs } }),
    })
    const deadline = new AbortController()
    const callerSignal = init.signal ?? (input instanceof Request ? input.signal : undefined)
    const signal = callerSignal == null ? deadline.signal : AbortSignal.any([callerSignal, deadline.signal])
    const timer = setTimeout(() => {
      deadline.abort(new Error(`BYCLAW_LLM_FIRST_RESPONSE_TIMEOUT: no response headers within ${firstResponseTimeoutMs}ms`))
    }, firstResponseTimeoutMs)
    try {
      const options = { ...init, signal, dispatcher }
      return await globalThis.fetch(input, options)
    } finally {
      clearTimeout(timer)
      // Graceful close waits for the response body to finish or be cancelled.
      // The caller's signal must remain connected throughout body streaming.
      void dispatcher.close().catch(() => dispatcher.destroy().catch(() => undefined))
    }
  }
}
