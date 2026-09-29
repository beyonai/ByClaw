import type { TenantIdentity } from "../domain/tenant.js";
export const operations = [
  "CREATE_SESSION",
  "CREATE_GROUP",
  "UPDATE_SESSION",
  "DELETE_SESSION",
  "ADD_MEMBERS",
  "JOIN_GROUP",
  "REMOVE_MEMBER",
  "SET_ROLE",
  "TRANSFER_OWNER",
  "LEAVE_GROUP",
  "DISSOLVE_GROUP",
  "ACK_DISSOLUTION",
  "UPDATE_SETTINGS",
  "READ_STATE",
  "CREATE_TASK",
  "UPDATE_TASK",
  "PUBLISH_TASK",
  "SAVE_PENDING_PUBLICATION",
  "DELETE_PENDING_PUBLICATION",
  "RECALL_MESSAGE",
  "SEND_GROUP_MESSAGE",
] as const;
export type Operation = (typeof operations)[number];
export interface TenantCommand extends TenantIdentity {
  protocolVersion: 1;
  userId: string;
  requestId: string;
  sessionId: string;
  operation: Operation;
  tenantMemberUserIds: string[];
  requestHash: string;
  payload: Record<string, any>;
}
