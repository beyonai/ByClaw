import { canonicalPayload } from "../../application/group-forward-snapshot.js";
import type { ForwardActor, ForwardInput } from "../../application/group-forward-types.js";
import { sha256 } from "./validation.js";

/** Hash the exact versioned preimage shared with BE, without changing its array order. */
export function canonicalHash(actor: ForwardActor, sourceId: string, input: ForwardInput): string {
  return sha256(canonicalPayload(actor, sourceId, input));
}
