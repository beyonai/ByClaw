/** Check the serving loop instance, rather than a potentially different dependency copy. */
export function assertDshModelRoutingRuntime(runtime) {
  if (runtime == null || runtime.byclawRequestReassembly !== true) {
    throw new Error('BYCLAW_MODEL_ROUTER_REASSEMBLY_REQUIRED: enable model routing with the ByClaw runtime compatibility build (DSH 0.1.5-rc.2); the active agentLoop service does not advertise request reassembly support')
  }
}
