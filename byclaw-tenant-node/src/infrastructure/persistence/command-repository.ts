import type { ConnectionManager } from "../../application/connection-manager.js";
import type { TenantCommand } from "../../application/command.js";
import type { CommandTransaction, CommandTransactions } from "../../application/command-service.js";
import type { SqlSession } from "../../application/database-ports.js";
import { CommandContext } from "./command-context.js";
import { first } from "./sql-utils.js";
import { joinGroup } from "./group-join.js";
import { createSession, changeSession, readState, recallMessage } from "./session-writer.js";
import { addMembers, removeMember, changeRole, groupSettings } from "./member-writer.js";
import { publishTask } from "./task-publication.js";
import { createTask, changeTask } from "./task-writer.js";
import { sendGroupMessage } from "./group-message-writer.js";

const handlers = {
  CREATE_SESSION: createSession,
  CREATE_GROUP: createSession,
  UPDATE_SESSION: changeSession,
  DELETE_SESSION: changeSession,
  ADD_MEMBERS: addMembers,
  JOIN_GROUP: joinGroup,
  REMOVE_MEMBER: removeMember,
  LEAVE_GROUP: removeMember,
  SET_ROLE: changeRole,
  TRANSFER_OWNER: changeRole,
  UPDATE_SETTINGS: groupSettings,
  DISSOLVE_GROUP: groupSettings,
  ACK_DISSOLUTION: groupSettings,
  READ_STATE: readState,
  CREATE_TASK: createTask,
  UPDATE_TASK: changeTask,
  PUBLISH_TASK: publishTask,
  SAVE_PENDING_PUBLICATION: changeTask,
  DELETE_PENDING_PUBLICATION: changeTask,
  RECALL_MESSAGE: recallMessage,
  SEND_GROUP_MESSAGE: sendGroupMessage,
};
export class SqlCommandTransactions implements CommandTransactions {
  constructor(private readonly connection: ConnectionManager) {}
  run<T>(work: (tx: CommandTransaction) => Promise<T>): Promise<T> {
    return this.connection.write((db) => work(new SqlCommandTransaction(db)));
  }
}
class SqlCommandTransaction implements CommandTransaction {
  constructor(private readonly db: SqlSession) {}
  async lock(sessionId: string): Promise<void> {
    await this.db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`session:${sessionId}`]);
  }
  authorize(command: TenantCommand) {
    return new CommandContext(this.db, command).authorize();
  }
  async previous(command: TenantCommand) {
    const row = await first(
      this.db,
      "SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code=$2",
      [command.sessionId, `node_command:${command.requestId}`],
    );
    return row ? JSON.parse(row.extParamValue) : null;
  }
  async apply(command: TenantCommand): Promise<Record<string, any>> {
    const messageId = await handlers[command.operation](new CommandContext(this.db, command));
    return {
      sessionId: command.sessionId,
      requestId: command.requestId,
      operation: command.operation,
      ...(typeof messageId === "string" ? { messageId } : {}),
    };
  }
  async record(command: TenantCommand, result: Record<string, any>): Promise<void> {
    await new CommandContext(this.db, command).setExtension(
      `node_command:${command.requestId}`,
      JSON.stringify({ hash: command.requestHash, userId: command.userId, result }),
    );
  }
}
