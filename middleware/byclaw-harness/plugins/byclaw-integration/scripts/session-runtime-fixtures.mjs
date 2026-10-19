/** Narrow test doubles for the current immutable DSH Session and live stream APIs. */
export function sessionLog(events = [], inheritedEventCount = 0) {
  const log = [...events]
  return {
    snapshotEvents() { return Object.freeze([...log]) },
    ownEvents() { return Object.freeze(log.slice(inheritedEventCount)) },
    appendEvent(event) { log.push(event) },
  }
}

/** Produce real start/chunk frames with dense attempt-local chunk positions. */
export function liveStreamFrames() {
  const attempts = new Map()
  let revision = 0
  return (session, turn, step, chunk) => {
    let attempt = attempts.get(session)
    const frames = []
    if (attempt === undefined || attempt.turn !== turn || attempt.step !== step) {
      attempt = { turn, step, attemptId: `test-attempt-${++revision}`, revision, index: 0 }
      attempts.set(session, attempt)
      frames.push({ type: 'start', attemptId: attempt.attemptId, revision, turn, step })
    }
    frames.push({ type: 'chunk', attemptId: attempt.attemptId, revision: attempt.revision,
      index: attempt.index++, time: Date.now(), chunk })
    return frames
  }
}
