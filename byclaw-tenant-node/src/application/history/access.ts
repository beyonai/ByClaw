import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import type { HistoryRepository, Row } from "./contracts.js";
import {
  GROUP_COORDINATION_SCOPE,
  parseGroupCoordination,
} from "../../domain/group-coordination.js";

/** 历史读取的共享权限规则；子会话沿父链授权，群任务同时校验原群与发起人。 */
export class HistoryAccess {
  constructor(
    protected readonly tenantId: string,
    protected readonly repository: HistoryRepository,
  ) {}
  async access(
    actor: string,
    sessionId: string,
    group = false,
    allowDissolved = false,
    visited = new Set<string>(),
  ): Promise<Row> {
    requireId(actor);
    requireId(sessionId);
    if (visited.has(sessionId) || visited.size >= 32)
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    visited.add(sessionId);
    const session = await this.repository.session(sessionId);
    if (
      !session ||
      session.enterpriseId !== this.tenantId ||
      ["GROUP_CHAT_ROUTING", "GROUP_CHAT_DISPATCH", "CLOSED"].includes(session.state)
    )
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    if (group && session.sessionType !== "hs_as") throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    if (session.sessionType === "hs_as") {
      if (!allowDissolved && session.state === "GROUP_DISSOLVED")
        throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
      if (!(await this.repository.member(sessionId, actor)))
        throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    } else {
      const candidate = ["GROUP_TASK_CANDIDATE", "GROUP_TASK"].includes(session.state)
        ? await this.repository.candidate?.(sessionId)
        : null;
      if (session.state === "GROUP_TASK_CANDIDATE") {
        if (!candidate || !["QUEUED", "RUNNING"].includes(candidate.status))
          throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
      }
      if (candidate) {
        await this.access(actor, candidate.groupSessionId, true, false, visited);
        if (candidate.initiatorUserId !== actor || session.creatorId !== actor)
          throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
        session.groupDispatch = {
          schemaVersion: "1",
          dispatchId: candidate.executionId,
          candidateSessionId: sessionId,
          groupSessionId: candidate.groupSessionId,
          sourceMessageId: candidate.sourceMessageId,
          initiatorUserId: candidate.initiatorUserId,
          targetAgentId: candidate.targetAgentId,
          status: candidate.status,
          disposition: candidate.disposition,
        };
        session.targetAgentId = candidate.targetAgentId;
      }
      const task = await this.repository.task(sessionId);
      if (task) {
        await this.access(actor, task.groupSessionId, true);
        if (task.initiatorUserId !== actor) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
        const extensions = await this.repository.extensions(sessionId);
        const scope = parseGroupCoordination(
          extensions.find((row) => row.extParamCode === GROUP_COORDINATION_SCOPE)?.extParamValue,
        );
        session.targetAgentId = task.targetAgentId;
        if (scope) session.groupCoordination = scope;
      } else if (candidate) {
        const extensions = await this.repository.extensions(sessionId);
        const scope = parseGroupCoordination(
          extensions.find((row) => row.extParamCode === GROUP_COORDINATION_SCOPE)?.extParamValue,
        );
        if (scope) session.groupCoordination = scope;
      } else if (session.parentSessionId) {
        if (session.sessionType === "h_as" && session.creatorId !== actor)
          throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
        const parent = await this.access(actor, session.parentSessionId, false, false, visited);
        if (parent.groupCoordination) {
          const scope = parseGroupCoordination(parent.groupCoordination)!;
          const target = session.objectId == null ? undefined : String(session.objectId);
          const externalChild = (await this.repository.extensions(sessionId)).some(
            (row) => row.extParamCode === "event_source" && row.extParamValue === "EXTERNAL_CHILD",
          );
          if (
            !target ||
            (externalChild
              ? target !== parent.targetAgentId
              : !scope.allowedAgentIds.includes(target))
          )
            throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
          session.groupCoordination = scope;
          session.groupCoordinationChild = true;
          session.targetAgentId = target;
        }
      } else if (session.creatorId !== actor) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    }
    return session;
  }
}
