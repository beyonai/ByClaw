/**
 * Wire vocabulary of devflow's own browser channel. The host half serves it and
 * the browser half calls it, so both sides read these types from one place.
 * @module @zhchxiao123/dsh-devflow-web/types
 */

/**
 * The read methods the route projects, one per last path segment.
 */
export type DevflowWebReadMethod = 'list' | 'detail' | 'archived' | 'midscene-summary'

/**
 * The write methods the route projects. Only the decisions a person makes
 * about a card's place on the board appear here — filing finished work,
 * filing one card, and dropping one. Stage moves, creation, claims, and
 * artifact registration stay off this face: those are the model tool plane's,
 * and putting them here would make the board a second executor.
 *
 * Restoring is deliberately absent too. Offering "take it back" beside "drop
 * it" reads as though dropping were reversible, which it is not; a restore is
 * made on the `/devflow` plane where the archive is read in full.
 */
export type DevflowWebWriteMethod = 'archive-done' | 'archive' | 'abandon'

/** Every method the route answers, read or write. */
export type DevflowWebMethod = DevflowWebReadMethod | DevflowWebWriteMethod | 'build-info'

/**
 * Request body of every read call. The viewing session is the only scoping key
 * the browser can choose — the host resolves it to a devflow root, so the wire
 * carries no path in this direction.
 */
export interface DevflowWebRequest {
  /** The viewing session; omitted reads the store's default root. */
  sessionId?: string
  /** The card `detail` reads; unused by the listing methods. */
  id?: string
  /** `archived`: only the cards filed under this `YYYY-MM` bucket. */
  month?: string
  /** `archived`: cards per page, clamped host-side. */
  limit?: number
  /**
   * `archived`: the previous page's `nextCursor`, passed back verbatim. The
   * encoding belongs to the store, so the browser neither builds nor parses
   * one and this face does not validate its shape.
   */
  cursor?: string
  /**
   * The writes' optimistic-concurrency token: the `stageRevision` the board
   * last read. Another plane may have moved the card since, which is ordinary
   * rather than exceptional — the write resolves `revision-mismatch` and the
   * board refetches.
   */
  expectedRevision?: number
  /**
   * `abandon`: why the work stopped. Required and non-blank, because it is the
   * entire record of a card that leaves the board — the store rejects an empty
   * one, and so does this face.
   */
  reason?: string
}

/**
 * Outcome of one write. A domain rejection travels with its stable code: the
 * browser branches on it — `revision-mismatch` refetches, `not-done` and
 * `already-done` point at the other action, `parent-active` names what to move
 * first — so a single opaque failure would strand every one of those.
 *
 * Only domain rejections carry a message. An infrastructure failure stays
 * host-side as it does for reads: the store names files under the devflow
 * root, and the browser must not learn a path it could not have sent.
 */
export interface DevflowWriteOutcome {
  /** The seam's verdict on this write. */
  result: { ok: true } | { ok: false; code: string; message: string }
  /** `archive-done`: the cards the sweep filed, in id order. */
  archived?: string[]
}

/**
 * Response envelope of every read call. A rejection is a settled answer, not a
 * transport failure: unknown sessions, missing cards, and unreadable journals
 * all arrive as `ok: false` with a one-line reason.
 */
export type DevflowWebResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

/**
 * One push frame: a card entered the active set, settled at a new location,
 * left for the archive, or came back. The frame names the change and carries
 * no card, because the
 * browser answers it by refetching through the read face — a payload here
 * would be a second truth racing the one the board renders.
 */
export interface DevflowChangeFrame {
  type: 'devflow/card-created' | 'devflow/stage-changed' | 'devflow/card-archived' | 'devflow/card-restored'
}

export interface BuildClient { artifact: string; entry: string }
export type BuildInfo =
  | { schemaVersion: 1; available: false }
  | {
    schemaVersion: 1
    available: true
    buildId: string
    instanceId: string
    serverSha256: string
    client: { path: string; sha256: string }
  }

export interface AcceptanceReports { workspace: string; output: string }

/** Read-only diagnostic projection. It never authorizes a card transition. */
export interface MidsceneSummary {
  available: boolean
  profiles: {
    name: string
    model: string
    family: string
    targetUrl: string
    browserMode: string
    login: 'snapshot' | 'borrowed' | 'none'
    formalConfigured: boolean
    preflight?: { at: string; model: 'available' | 'unknown' | 'unavailable' }
    latestRun?: { runId: string; at: string; status: string; reportUrl?: string }
  }[]
  jobs: { id: string; status: string }[]
  gateEngineAvailable: boolean
}

/** Optional provider, resolved only after the web face verifies session/card access. */
export interface DevflowMidsceneSummary {
  read(sessionId: string, cardId: string): Promise<MidsceneSummary>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    devflowMidsceneSummary: DevflowMidsceneSummary
    /** Resolve host-private output for an already canonical session workspace. */
    devflowMidsceneReports: { output(workspace: string): Promise<string> }
  }
}
