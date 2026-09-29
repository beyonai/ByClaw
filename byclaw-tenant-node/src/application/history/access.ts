import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import type { HistoryRepository, Row } from "./contracts.js";

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
      ["GROUP_CHAT_ROUTING", "CLOSED"].includes(session.state)
    )
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    if (group && session.sessionType !== "hs_as") throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    if (session.sessionType === "hs_as") {
      if (!allowDissolved && session.state === "GROUP_DISSOLVED")
        throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
      if (!(await this.repository.member(sessionId, actor)))
        throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    } else {
      const task = await this.repository.task(sessionId);
      if (task) {
        await this.access(actor, task.groupSessionId, true);
        if (task.initiatorUserId !== actor) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
      } else if (session.parentSessionId) {
        await this.access(actor, session.parentSessionId, false, false, visited);
      } else if (session.creatorId !== actor) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    }
    return session;
  }
}
