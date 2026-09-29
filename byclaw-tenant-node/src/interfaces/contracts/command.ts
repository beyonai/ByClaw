import { operations, type TenantCommand } from "../../application/command.js";
import { DomainError } from "../../domain/errors.js";
import { assertTenant, type TenantIdentity } from "../../domain/tenant.js";
import { requireId } from "../../domain/values.js";
import { canonical, digest, opaqueId, record, sha256 } from "./validation.js";
/** 业务摘要排除代际、实例和成员断言；这些单独鉴权，重发同一业务仍可命中幂等结果。 */
export function commandHash(input: Omit<TenantCommand, "requestHash"> | TenantCommand): string {
  const {
    requestHash: _,
    generation: _generation,
    dbSandboxRecordId: _record,
    tenantMemberUserIds: _members,
    ...command
  } = input as TenantCommand;
  return sha256(canonical(command));
}
/** 入口核验固定身份、协议、真实 actor 与完整命令摘要；具体资源权限留给事务内判断。 */
export function validateTenantCommand(
  input: unknown,
  identity: TenantIdentity,
  actor?: string,
): TenantCommand {
  const command = record(input) as TenantCommand;
  assertTenant(command, identity);
  const keys = [
    "protocolVersion",
    "enterpriseId",
    "generation",
    "dbSandboxRecordId",
    "userId",
    "requestId",
    "sessionId",
    "operation",
    "tenantMemberUserIds",
    "requestHash",
    "payload",
  ];
  if (
    Object.keys(command).some((key) => !keys.includes(key)) ||
    command.protocolVersion !== 1 ||
    !operations.includes(command.operation) ||
    !Array.isArray(command.tenantMemberUserIds) ||
    !command.tenantMemberUserIds.length ||
    command.tenantMemberUserIds.length > 1000
  )
    throw new DomainError("INVALID_COMMAND");
  requireId(command.userId);
  requireId(command.sessionId);
  opaqueId(command.requestId);
  digest(command.requestHash);
  record(command.payload);
  command.tenantMemberUserIds.forEach(requireId);
  if (!command.tenantMemberUserIds.includes(command.userId) || (actor && actor !== command.userId))
    throw new DomainError("COMMAND_CONTEXT_MISMATCH");
  if (commandHash(command) !== command.requestHash) throw new DomainError("HASH_MISMATCH");
  return command;
}
