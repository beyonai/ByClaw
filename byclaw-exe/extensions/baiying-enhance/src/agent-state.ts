import type { AdaptedManagedAgent } from "./agent-adapter.js";

/** In-memory registry of the last successful agent sync (used by HTTP routes and sync engine). */
export class AgentRegistryState {
  private readonly byId = new Map<string, AdaptedManagedAgent>();

  replaceAll(next: AdaptedManagedAgent[]) {
    this.byId.clear();
    for (const a of next) {
      this.byId.set(a.agentId, a);
    }
  }

  get(agentId: string): AdaptedManagedAgent | undefined {
    return this.byId.get(agentId);
  }

  list(): AdaptedManagedAgent[] {
    return [...this.byId.values()];
  }
}
