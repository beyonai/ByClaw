/**
 * The devflow bundle: a package whose substance is `cordis.patch.yml`, not
 * code. `dsh plugin add` reconciles a profile's bundle stack against installed
 * packages, and a dependency declaring `dsh.bundle` joins that stack — so
 * installing this package is what mounts the whole plugin line.
 *
 * There is no runtime API, and deliberately no plugin body: the patch mounts
 * each devflow plugin as its own row, which is what keeps every per-row
 * control a hand-written composition would have had. A bundle that also
 * registered behavior would take that away.
 * @module @zhchxiao123/dsh-devflow-bundle
 */

export {}
