const sharedWorkerRoute = /^BYCLAW_DSH_SHARED_(.+)_([0-9]+)$/u
const personalWorkerRoute = /^BYCLAW_DSH_(?!SHARED_)(.+)$/u

/**
 * Accept a shared-sandbox generation advance, or an atomic transition between
 * one personal DSH route and one shared DSH route in either direction.
 */
export function isSafeSharedWorkerRouteRefresh(
  current: Readonly<Record<string, string>>,
  requested: Readonly<Record<string, string>>,
): boolean {
  const currentIds = Object.keys(current).sort()
  const requestedIds = Object.keys(requested).sort()
  if (JSON.stringify(currentIds) !== JSON.stringify(requestedIds)) return false
  const changedIds = requestedIds.filter(id => current[id] !== requested[id])
  const isSharedGenerationAdvance = requestedIds.every(id => {
    const currentRoute = current[id]!
    const requestedRoute = requested[id]!
    if (currentRoute === requestedRoute) return true
    const currentShared = sharedWorkerRoute.exec(currentRoute)
    const requestedShared = sharedWorkerRoute.exec(requestedRoute)
    return currentShared !== null && requestedShared !== null
      && currentShared[1] === requestedShared[1]
      && BigInt(requestedShared[2]!) > BigInt(currentShared[2]!)
  })
  if (isSharedGenerationAdvance) return true

  const isSingleRouteTransition = (currentPattern: RegExp, requestedPattern: RegExp): boolean => {
    const currentRoutes = new Set<string>()
    const requestedRoutes = new Set<string>()
    for (const id of changedIds) {
      const currentRoute = current[id]!
      const requestedRoute = requested[id]!
      if (!currentPattern.test(currentRoute) || !requestedPattern.test(requestedRoute)) return false
      currentRoutes.add(currentRoute)
      requestedRoutes.add(requestedRoute)
    }
    return changedIds.length > 0 && currentRoutes.size === 1 && requestedRoutes.size === 1
  }
  return isSingleRouteTransition(personalWorkerRoute, sharedWorkerRoute)
    || isSingleRouteTransition(sharedWorkerRoute, personalWorkerRoute)
}
