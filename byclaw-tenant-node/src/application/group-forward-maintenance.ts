import { DomainError } from "../domain/errors.js";
import type { ForwardOperationLocator } from "./group-forward-types.js";
export type RecoveryCategory = "WORK" | "DELIVERY";
export interface RecoveryCandidate {
  locator: ForwardOperationLocator;
  targetId: string;
  sourcesFrozen: boolean;
}
export interface RecoveryPage {
  candidates: RecoveryCandidate[];
  nextCursor: string | null;
}
export interface DeliveryLease {
  locator: ForwardOperationLocator;
  targetId: string;
  owner: string;
  fencingVersion: string;
  leaseUntil: string;
  pendingMessageIds: string[];
}
export interface CurrentDelivery {
  targetId: string;
  enterpriseId: string;
  sessionId: string;
  messages: Record<string, unknown>[];
  userRecipientIds: string[];
}
export type DeliveryOutcome = "ENQUEUED" | "SUPPRESSED";
export function maintenance(checkpoint: any): any {
  if (checkpoint.maintenance == null) checkpoint.maintenance = { schemaVersion: 1 };
  if (checkpoint.maintenance.schemaVersion !== 1)
    throw new DomainError("FORWARD_MAINTENANCE_INVALID");
  return checkpoint.maintenance;
}
export function pendingMessages(checkpoint: any, ids: string[]): string[] {
  const entries = maintenance(checkpoint).delivery?.messages ?? [];
  if (
    !Array.isArray(entries) ||
    entries.some(
      (e: any) => !ids.includes(e.messageId) || !["ENQUEUED", "SUPPRESSED"].includes(e.outcome),
    )
  )
    throw new DomainError("FORWARD_MAINTENANCE_INVALID");
  return ids.filter((id) => !entries.some((e: any) => e.messageId === id));
}
export function recordDelivery(
  checkpoint: any,
  messageId: string,
  outcome: DeliveryOutcome,
  now: Date,
): void {
  const m = maintenance(checkpoint);
  m.delivery ??= { messages: [] };
  m.delivery.messages ??= [];
  if (!m.delivery.messages.some((entry: any) => entry.messageId === messageId))
    m.delivery.messages.push({ messageId, outcome, completedAt: now.toISOString() });
}
export interface ForwardRecoveryPort {
  scan(category: RecoveryCategory, after: string | null, limit: number): Promise<RecoveryPage>;
  claimDelivery(
    locator: ForwardOperationLocator,
    targetId: string,
    owner: string,
    duration: number,
  ): Promise<DeliveryLease | null>;
  delivery(lease: DeliveryLease, messageId: string): Promise<CurrentDelivery | null>;
  markDelivered(
    lease: DeliveryLease,
    messageId: string,
    outcome: DeliveryOutcome,
  ): Promise<DeliveryLease>;
  renewDelivery(lease: DeliveryLease, duration: number): Promise<DeliveryLease>;
  failRequest(
    lease: import("./group-forward-types.js").RequestLease,
    code: string,
    retryable: boolean,
  ): Promise<void>;
  failTarget(
    lease: import("./group-forward-types.js").TargetLease,
    code: string,
    retryable: boolean,
  ): Promise<void>;
}
