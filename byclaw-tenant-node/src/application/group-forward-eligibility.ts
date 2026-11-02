import { DomainError } from "../domain/errors.js";
import { requireId } from "../domain/values.js";
import type { ForwardActor } from "./group-forward-types.js";

export interface GroupIdentity {
  readonly sessionId: string;
  readonly enterpriseId: string | null;
  readonly sessionType: string;
  readonly state?: string | null;
}

const unavailableStates = new Set([
  "GROUP_DISSOLVED",
  "CLOSED",
  "GROUP_CHAT_ROUTING",
  "GROUP_CHAT_DISPATCH",
]);

/** Shared by selection, preparation and commit; source membership is checked by the caller. */
export function requireSource(
  actor: ForwardActor,
  source: GroupIdentity | null,
  isUserMember: boolean,
): void {
  requireId(actor.userId);
  requireId(actor.enterpriseId);
  if (!source || !isUserMember) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  if (source.enterpriseId == null) throw new DomainError("FORWARD_TENANT_UNRESOLVED");
  if (
    source.enterpriseId !== actor.enterpriseId ||
    source.sessionType !== "hs_as" ||
    unavailableStates.has(source.state ?? "")
  )
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
}

/** Recheck the actual source identity and target membership before each write boundary. */
export function requireTarget(
  actor: ForwardActor,
  source: GroupIdentity,
  target: GroupIdentity | null,
  isUserMember: boolean,
): void {
  requireSource(actor, source, true);
  if (
    !target ||
    !isUserMember ||
    target.sessionId === source.sessionId ||
    target.enterpriseId !== source.enterpriseId ||
    target.sessionType !== "hs_as" ||
    unavailableStates.has(target.state ?? "")
  )
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
}
