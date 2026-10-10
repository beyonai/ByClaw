import type { CommandContext } from "./command-context.js";
import { first, insert, nextId } from "./sql-utils.js";
import { DomainError } from "../../domain/errors.js";
import {
  GROUP_COORDINATION_SCOPE,
  GROUP_COORDINATOR_AGENT_ID,
  type GroupCoordination,
} from "../../domain/group-coordination.js";

export interface GroupDispatch {
  taskSessionId: string;
  targetAgentId: string;
  dispatchId?: string;
  groupCoordination?: GroupCoordination;
}

/** 共用群任务创建，事务内保存源消息与待调度任务，BE 提交后执行。 */
export async function createGroupTasks(
  context: CommandContext,
  id: string,
  content: string,
  agents: string[],
) {
  const { db, command } = context;
  const selected = [...new Set(agents)];
  const dispatches: GroupDispatch[] = [];
  if (!selected.length) return dispatches;
  const coordinator = await first(
    db,
    "SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code=$2",
    [command.sessionId, GROUP_COORDINATOR_AGENT_ID],
  );
  const coordinatorAgentId = coordinator?.extParamValue;
  if (selected.length > 1 && !coordinatorAgentId)
    throw new DomainError("GROUP_COORDINATOR_NOT_CONFIGURED");
  const coordinated = selected.length > 1;
  const targets = coordinated ? [coordinatorAgentId] : selected;
  let allowedAgentIds = selected.filter((id) => id !== coordinatorAgentId);
  if (!coordinated && coordinatorAgentId) {
    const members = await db.query(
      "SELECT mem_obj_id FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='AGENT' AND com_acct_id=$2",
      [command.sessionId, command.enterpriseId],
    );
    allowedAgentIds = members
      .map((member) => String(member.mem_obj_id ?? member.memObjId))
      .filter((id) => id !== coordinatorAgentId);
  }
  for (const agentId of targets) {
    if (
      !(await first(
        db,
        "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='AGENT' AND mem_obj_id=$2 AND com_acct_id=$3",
        [command.sessionId, agentId, command.enterpriseId],
      ))
    )
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    const taskSessionId = await nextId(db, command.enterpriseId);
    const dispatchId = await nextId(db, command.enterpriseId);
    await insert(db, "byai_session", {
      session_id: taskSessionId,
      parent_session_id: command.sessionId,
      creator_id: command.userId,
      enterprise_id: command.enterpriseId,
      session_name: content.slice(0, 255) || "群聊任务",
      session_type: "h_as",
      state: coordinated ? "GROUP_TASK" : "GROUP_TASK_CANDIDATE",
      object_id: agentId,
      last_seq: "0",
      create_time: new Date(),
      update_time: new Date(),
    });
    if (coordinated)
      await insert(db, "byai_group_chat_task", {
        task_session_id: taskSessionId,
        group_session_id: command.sessionId,
        source_message_id: id,
        dispatch_id: dispatchId,
        initiator_user_id: command.userId,
        target_agent_id: agentId,
        task_name: content.slice(0, 255) || "群聊任务",
        status: "ACTIVE",
        turn_status: "QUEUED",
        create_time: new Date(),
        update_time: new Date(),
      });
    else
      await insert(db, "byai_group_chat_execution", {
        execution_id: dispatchId,
        group_session_id: command.sessionId,
        source_message_id: id,
        root_message_id: id,
        initiator_user_id: command.userId,
        target_agent_id: agentId,
        candidate_session_id: taskSessionId,
        status: "QUEUED",
        disposition: "UNKNOWN",
        create_time: new Date(),
      });
    await insert(db, "byai_session_ext", {
      ext_id: await nextId(db, command.enterpriseId),
      session_id: taskSessionId,
      ext_param_name: "group_auto_dispatch",
      ext_param_code: "group_auto_dispatch",
      ext_param_value: id,
    });
    const scope: GroupCoordination | undefined = coordinatorAgentId
      ? {
          schemaVersion: "byclaw.group-coordination/v1",
          mode: coordinated ? "COORDINATED" : "DIRECT",
          groupSessionId: command.sessionId,
          taskSessionId,
          coordinatorAgentId,
          allowedAgentIds,
        }
      : undefined;
    if (scope)
      await insert(db, "byai_session_ext", {
        ext_id: await nextId(db, command.enterpriseId),
        session_id: taskSessionId,
        ext_param_name: GROUP_COORDINATION_SCOPE,
        ext_param_code: GROUP_COORDINATION_SCOPE,
        ext_param_value: JSON.stringify(scope),
      });
    dispatches.push({
      taskSessionId,
      targetAgentId: agentId,
      dispatchId,
      ...(scope ? { groupCoordination: scope } : {}),
    });
  }
  return dispatches;
}
