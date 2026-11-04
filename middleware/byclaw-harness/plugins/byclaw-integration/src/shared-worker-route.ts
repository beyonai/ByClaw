const sharedWorkerRoute = /^BYCLAW_DSH_SHARED_(.+)_([0-9]+)$/u

/** Only the generation of an existing shared-sandbox route may advance. */
export function isSafeSharedWorkerRouteRefresh(
  current: Readonly<Record<string, string>>,
  requested: Readonly<Record<string, string>>,
): boolean {
  const currentIds = Object.keys(current).sort()
  const requestedIds = Object.keys(requested).sort()
  if (JSON.stringify(currentIds) !== JSON.stringify(requestedIds)) return false
  return requestedIds.every(id => {
    const currentRoute = current[id]!
    const requestedRoute = requested[id]!
    if (currentRoute === requestedRoute) return true
    const currentShared = sharedWorkerRoute.exec(currentRoute)
    const requestedShared = sharedWorkerRoute.exec(requestedRoute)
    return currentShared !== null && requestedShared !== null
      && currentShared[1] === requestedShared[1]
      && BigInt(requestedShared[2]!) > BigInt(currentShared[2]!)
  })
}
