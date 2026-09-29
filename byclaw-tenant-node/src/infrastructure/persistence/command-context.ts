import type { TenantCommand } from "../../application/command.js";
import type { SqlRow, SqlSession } from "../../application/database-ports.js";
import { DomainError } from "../../domain/errors.js";
import { first, insert, nextId } from "./sql-utils.js";

export class CommandContext {
  constructor(
    readonly db: SqlSession,
    readonly command: TenantCommand,
  ) {}
  session(): Promise<SqlRow | null> {
    return first(
      this.db,
      "SELECT * FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2",
      [this.command.sessionId, this.command.enterpriseId],
    );
  }
  member(userId = this.command.userId): Promise<SqlRow | null> {
    return first(
      this.db,
      "SELECT * FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3",
      [this.command.sessionId, userId, this.command.enterpriseId],
    );
  }
  async authorize(): Promise<void> {
    const session = await this.session();
    if (!session) {
      if (["CREATE_SESSION", "CREATE_GROUP"].includes(this.command.operation)) return;
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    }
    if (
      session.state === "GROUP_CHAT_ROUTING" ||
      (session.state === "CLOSED" && this.command.operation !== "DELETE_SESSION")
    )
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    if (
      session.state === "GROUP_DISSOLVED" &&
      !["ACK_DISSOLUTION", "DISSOLVE_GROUP"].includes(this.command.operation)
    )
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    if (session.sessionType === "hs_as") {
      if (
        this.command.operation === "JOIN_GROUP" &&
        this.command.payload.joinLinkAuthorized === true
      )
        return;
      if (!(await this.member())) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    } else {
      if (session.creatorId !== this.command.userId)
        throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
      const task = await first(
        this.db,
        "SELECT group_session_id,initiator_user_id FROM byai.byai_group_chat_task WHERE task_session_id=$1",
        [this.command.sessionId],
      );
      if (task) {
        const group = await first(
          this.db,
          "SELECT 1 FROM byai.byai_session s JOIN byai.byai_session_member m ON m.session_id=s.session_id WHERE s.session_id=$1 AND s.enterprise_id=$2 AND s.session_type='hs_as' AND COALESCE(s.state,'ACTIVE') NOT IN('GROUP_DISSOLVED','CLOSED') AND m.mem_obj_type='USER' AND m.mem_obj_id=$3 AND m.com_acct_id=$2",
          [task.groupSessionId, this.command.enterpriseId, this.command.userId],
        );
        if (!group || task.initiatorUserId !== this.command.userId)
          throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
      }
    }
  }
  async requireRole(roles: string[]): Promise<void> {
    const session = await this.session();
    if (session?.sessionType !== "hs_as" || !roles.includes((await this.member())?.userRole))
      throw new DomainError("FORBIDDEN");
  }
  async setExtension(code: string, value: string): Promise<void> {
    const existing = await first(
      this.db,
      "SELECT ext_id FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code=$2",
      [this.command.sessionId, code],
    );
    if (existing) {
      await this.db.query("UPDATE byai.byai_session_ext SET ext_param_value=$1 WHERE ext_id=$2", [
        value,
        existing.extId,
      ]);
      return;
    }
    await insert(this.db, "byai_session_ext", {
      ext_id: await nextId(this.db),
      session_id: this.command.sessionId,
      ext_param_name: code,
      ext_param_code: code,
      ext_param_value: value,
    });
  }
}
