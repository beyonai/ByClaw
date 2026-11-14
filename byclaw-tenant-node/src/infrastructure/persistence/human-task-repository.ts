import { createHash } from "node:crypto";
import type { ConnectionManager } from "../../application/connection-manager.js";
import type { SqlSession } from "../../application/database-ports.js";
import {
  check,
  humanTaskItems,
  requestId,
  requireReview,
  requireSubmission,
  taskId,
  type HumanTaskJson as Json,
} from "../../domain/human-task.js";
import { camel, first, insert, nextId } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage } from "./group-message-index.js";
import {
  GROUP_COORDINATION_SCOPE,
  GROUP_COORDINATOR_AGENT_ID,
  type GroupCoordination,
} from "../../domain/group-coordination.js";
import { readGroupCoordination } from "./group-coordination.js";

const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const hash = (value: Json): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const parsed = (row: Json | null): Json | null => (row ? JSON.parse(row.payload) : null);
/** Sender columns remain authoritative after an old payload is repaired by migration. */
const parsedBatch = (row: Json | null): Json | null => {
  const batch = parsed(row);
  return batch ? { ...batch, senderType: row!.senderType, senderId: String(row!.senderId) } : null;
};
const now = (): string => new Date().toISOString();

/** Fixed predicates keep list totals and dashboard counts aligned without interpolating caller SQL. */
function viewPredicate(view: unknown): string {
  check(
    view === "PENDING_REVIEW" ||
      view === "PENDING_COMPLETION" ||
      view === "PENDING_MODIFICATION",
    "INVALID_VIEW",
  );
  switch (view) {
    case "PENDING_REVIEW":
      return "initiator_user_id=$2 AND status='PENDING_REVIEW'";
    case "PENDING_COMPLETION":
      return "assignee_user_id=$2 AND initiator_user_id<>$2 AND status IN ('PENDING','CHANGES_REQUESTED')";
    case "PENDING_MODIFICATION":
      return "assignee_user_id=$2 AND initiator_user_id<>$2 AND status='CHANGES_REQUESTED'";
  }
}

/** Group selection only narrows participant visibility and never depends on current membership. */
function groupFilter(body: Json, args: unknown[]): string {
  if (body.groupSessionId == null) return "";
  args.push(taskId(body, "groupSessionId"));
  return ` AND group_session_id=$${args.length}`;
}

/** Every command runs in the owning tenant transaction and uses SQL CAS, never a node-local lock. */
export class HumanTaskRepository {
  constructor(
    private readonly connection: Pick<ConnectionManager, "write">,
    private readonly tenant: string,
  ) {}
  async call(actor: string, action: string, body: Json): Promise<Json | null> {
    taskId({ actor }, "actor");
    const execute = () =>
      this.connection.write((db) =>
        new HumanTaskTransaction(db, this.tenant, actor).call(action, body),
      );
    try {
      return await execute();
    } catch (error) {
      // A competing idempotent request may win after our initial read; reload only after rollback.
      const code = (error as { code?: string }).code;
      if (code === "23505" || (action === "confirm" && code === "HUMAN_TASK_STALE_PROPOSAL"))
        return execute();
      throw error;
    }
  }
}
export class HumanTaskTransaction {
  constructor(
    private readonly db: SqlSession,
    private readonly tenant: string,
    private readonly actor: string,
  ) {}
  async call(action: string, body: Json): Promise<Json | null> {
    switch (action) {
      case "createProposal":
        return this.create(body, false);
      case "createDirect":
        return this.create(body, true);
      case "proposalSender":
        taskId(body, "sourceTaskSessionId");
        return this.creationSource(body, false);
      case "proposal":
        return this.batch(taskId(body, "batchId"), false);
      case "batch":
        return this.batch(taskId(body, "batchId"), true);
      case "updateProposal":
        return this.update(body);
      case "confirm":
        return this.confirm(body);
      case "task":
        return this.task(taskId(body, "humanTaskId"));
      case "list":
        return this.list(body);
      case "groupList":
        return this.groupList(body);
      case "counts":
        return this.counts(body);
      case "history":
        return this.history(taskId(body, "humanTaskId"));
      case "binding":
        return this.binding(taskId(body, "taskSessionId"));
      case "bind":
        return body.taskSessionId ? this.bind(body) : this.createSession(body);
      case "createSession":
        return this.createSession(body);
      case "submit":
        return this.submit(body);
      case "review":
        return this.review(body);
      case "request":
        return this.request(taskId(body, "humanTaskId"), requestId(body));
      case "checkpoint":
        return this.checkpoint(body);
      default:
        check(false, "INVALID_ACTION");
    }
  }
  private next(): Promise<string> {
    return nextId(this.db, this.tenant);
  }
  private async member(group: string, type: string, id: string): Promise<boolean> {
    return !!(await first(
      this.db,
      "SELECT 1 FROM byai.byai_session_member m JOIN byai.byai_session s ON s.session_id=m.session_id WHERE m.session_id=$1 AND m.mem_obj_type=$2 AND m.mem_obj_id=$3 AND m.com_acct_id=$4 AND s.enterprise_id=$4 AND s.session_type='hs_as' AND COALESCE(s.state,'ACTIVE')!='GROUP_DISSOLVED'",
      [group, type, id, this.tenant],
    ));
  }
  /** Creation and the authenticated BE's name lookup resolve exactly the same persisted identity. */
  private async creationSource(body: Json, direct: boolean): Promise<Json> {
    let group = body.groupSessionId == null ? null : taskId(body, "groupSessionId");
    let source = direct || body.sourceMessageId == null ? null : taskId(body, "sourceMessageId");
    const session =
      direct || body.sourceTaskSessionId == null ? null : taskId(body, "sourceTaskSessionId");
    let senderType = "USER",
      senderId = this.actor;
    if (session) {
      const scopes = (
        await this.db.query(
          `SELECT t.group_session_id,t.source_message_id,t.initiator_user_id,t.target_agent_id
         FROM byai.byai_group_chat_task t JOIN byai.byai_session s ON s.session_id=t.task_session_id AND s.enterprise_id=$2
         JOIN byai.byai_session g ON g.session_id=t.group_session_id AND g.enterprise_id=$2 WHERE t.task_session_id=$1
         UNION ALL SELECT e.group_session_id,e.source_message_id,e.initiator_user_id,e.target_agent_id
         FROM byai.byai_group_chat_execution e JOIN byai.byai_session s ON s.session_id=e.candidate_session_id AND s.enterprise_id=$2
         JOIN byai.byai_session g ON g.session_id=e.group_session_id AND g.enterprise_id=$2 WHERE e.candidate_session_id=$1`,
          [session, this.tenant],
        )
      ).map(camel);
      check(scopes.length, "SOURCE_MISMATCH");
      const scope = scopes[0]!;
      // A promoted execution may exist in both tables; conflicting identities must never be guessed.
      check(
        scopes.every((candidate) =>
          ["groupSessionId", "sourceMessageId", "initiatorUserId", "targetAgentId"].every(
            (key) => String(candidate[key]) === String(scope[key]),
          ),
        ),
        "SOURCE_AMBIGUOUS",
      );
      check(String(scope.initiatorUserId) === this.actor, "SOURCE_MISMATCH");
      check(group === null || group === String(scope.groupSessionId), "SOURCE_MISMATCH");
      check(source === null || source === String(scope.sourceMessageId), "SOURCE_MISMATCH");
      group = String(scope.groupSessionId);
      source = scope.sourceMessageId == null ? null : String(scope.sourceMessageId);
      senderType = "AGENT";
      senderId = taskId({ senderId: String(scope.targetAgentId) }, "senderId");
    }
    return {
      groupSessionId: taskId({ groupSessionId: group }, "groupSessionId"),
      sourceMessageId: source,
      sourceTaskSessionId: session,
      senderType,
      senderId,
    };
  }
  /** Only normalized business fields participate in the creation hash. */
  private async creationInput(body: Json, direct: boolean): Promise<Json> {
    return {
      ...(await this.creationSource(body, direct)),
      creationMode: direct ? "DIRECT" : "PROPOSAL",
      requestId: requestId(body),
      items: humanTaskItems(body.items, false),
    };
  }
  private async create(body: Json, direct: boolean): Promise<Json> {
    const resolved = body._resolvedSender;
    body = { ...body };
    // Internal enrichment was absent from legacy request hashes and must not change retry identity.
    delete body._resolvedSender;
    const input = await this.creationInput(body, direct);
    let resolvedName: string | null = null;
    if (input.senderType === "AGENT" && resolved != null) {
      // The authenticated BE owns platform names; its enrichment must match this execution's employee.
      check(
        typeof resolved === "object" &&
          !Array.isArray(resolved) &&
          resolved.senderId === input.senderId &&
          (resolved.senderName == null || typeof resolved.senderName === "string"),
        "SOURCE_MISMATCH",
      );
      resolvedName =
        typeof resolved.senderName === "string" && resolved.senderName.trim()
          ? resolved.senderName
          : null;
    }
    const { requestId: req, groupSessionId: group, sourceMessageId: source } = input;
    const digest = hash(input);
    const old = parsedBatch(
      await first(
        this.db,
        "SELECT payload,sender_type,sender_id FROM byai.byai_group_human_task_batch WHERE enterprise_id=$1 AND initiator_user_id=$2 AND request_id=$3",
        [this.tenant, this.actor, req],
      ),
    );
    if (old) {
      // Pre-sender proposals hashed the raw request after resolving only its source fields.
      // Preserve exact retries without rewriting migrated identities or accepting them as direct creations.
      const legacyMatches =
        !direct &&
        !Object.hasOwn(old, "creationMode") &&
        old.payloadHash ===
          hash(
            input.sourceTaskSessionId
              ? { ...body, groupSessionId: group, sourceMessageId: source }
              : body,
          );
      check(
        (!direct || old.creationMode === "DIRECT") && (old.payloadHash === digest || legacyMatches),
        "IDEMPOTENCY_MISMATCH",
      );
      // A retry must expose current task state, never the initial PENDING snapshot.
      return this.batch(old.batchId, true);
    }
    check(await this.member(group, "USER", this.actor), "GROUP_SCOPE_MISMATCH");
    if (source !== null) {
      const message = await first(
        this.db,
        "SELECT creator_id FROM byai.byai_message WHERE message_id=$1 AND session_id=$2 AND enterprise_id=$3",
        [source, group, this.tenant],
      );
      check(message && String(message.creatorId) === this.actor, "SOURCE_MISMATCH");
    }
    if (direct) await this.validateAssignees(group, humanTaskItems(input.items, true));
    const batch: Json = {
      ...input,
      batchId: await this.next(),
      initiatorUserId: this.actor,
      senderName: resolvedName ?? (await this.senderName(input)),
      payloadHash: digest,
      status: direct ? "CONFIRMED" : "DRAFT",
      revision: direct ? 1 : 0,
      createdAt: now(),
      ...(direct
        ? { cardMessageId: await this.next(), confirmedAt: now() }
        : { proposalMessageId: await this.next() }),
    };
    await insert(this.db, "byai_group_human_task_batch", {
      batch_id: batch.batchId,
      enterprise_id: this.tenant,
      group_session_id: group,
      initiator_user_id: this.actor,
      sender_type: batch.senderType,
      sender_id: batch.senderId,
      source_message_id: source,
      request_id: req,
      payload_hash: digest,
      status: batch.status,
      revision: batch.revision,
      card_message_id: batch.cardMessageId ?? null,
      payload: JSON.stringify(batch),
      create_time: new Date(),
      update_time: new Date(),
    });
    if (direct) {
      await this.createTasks(batch, input.items);
      await this.message(batch, "HUMAN_TASK_BATCH", batch.cardMessageId);
      return { ...(await this.batch(batch.batchId, true)), _createdMessageId: batch.cardMessageId };
    }
    await this.message(batch, "HUMAN_TASK_PROPOSAL", batch.proposalMessageId);
    return { ...batch, _createdMessageId: batch.proposalMessageId };
  }
  private async batch(id: string, withTasks: boolean): Promise<Json> {
    const b = parsedBatch(
      await first(
        this.db,
        "SELECT payload,sender_type,sender_id FROM byai.byai_group_human_task_batch WHERE enterprise_id=$1 AND batch_id=$2",
        [this.tenant, id],
      ),
    );
    check(b, "NOT_FOUND");
    if (withTasks && b.status === "CONFIRMED")
      b.items = (
        await this.db.query(
          "SELECT payload FROM byai.byai_group_human_task WHERE enterprise_id=$1 AND batch_id=$2 ORDER BY human_task_id",
          [this.tenant, id],
        )
      ).map((row) => JSON.parse(row.payload));
    return b;
  }
  private async updateBatch(batch: Json, expected: number): Promise<void> {
    const changed = await this.db.query(
      "UPDATE byai.byai_group_human_task_batch SET status=$1,revision=$2,payload=$3,card_message_id=$4,update_time=CURRENT_TIMESTAMP WHERE enterprise_id=$5 AND batch_id=$6 AND revision=$7 AND status='DRAFT' RETURNING batch_id",
      [
        batch.status,
        batch.revision,
        JSON.stringify(batch),
        batch.cardMessageId ?? null,
        this.tenant,
        batch.batchId,
        expected,
      ],
    );
    check(changed.length === 1, "STALE_PROPOSAL");
  }
  private async update(body: Json): Promise<Json> {
    const b = await this.batch(taskId(body, "batchId"), false);
    check(b.initiatorUserId === this.actor, "INITIATOR_REQUIRED");
    check(b.status === "DRAFT", "PROPOSAL_CONFIRMED");
    check(body.expectedRevision === b.revision, "STALE_PROPOSAL");
    const rev = b.revision;
    b.items = humanTaskItems(body.items, false);
    b.revision++;
    await this.updateBatch(b, rev);
    return b;
  }
  private async confirm(body: Json): Promise<Json> {
    const b = await this.batch(taskId(body, "batchId"), false);
    check(b.initiatorUserId === this.actor, "INITIATOR_REQUIRED");
    if (b.status === "CONFIRMED") return this.batch(b.batchId, true);
    check(body.expectedRevision === b.revision, "STALE_PROPOSAL");
    check(await this.member(b.groupSessionId, "USER", this.actor), "GROUP_SCOPE_MISMATCH");
    const items = humanTaskItems(b.items, true);
    await this.validateAssignees(b.groupSessionId, items);
    const rev = b.revision;
    b.status = "CONFIRMED";
    b.revision++;
    b.cardMessageId = await this.next();
    b.confirmedAt = now();
    await this.updateBatch(b, rev);
    await this.createTasks(b, items);
    await this.message(b, "HUMAN_TASK_BATCH", b.cardMessageId);
    return { ...(await this.batch(b.batchId, true)), _createdMessageId: b.cardMessageId };
  }
  private async validateAssignees(group: string, items: Json[]): Promise<void> {
    for (const item of items)
      check(await this.member(group, "USER", item.assigneeUserId), "ASSIGNEE_NOT_GROUP_MEMBER");
  }
  /** Both creation paths materialize tasks in the same transaction as their single formal card. */
  private async createTasks(b: Json, items: Json[]): Promise<void> {
    for (let position = 0; position < items.length; position++) {
      const t: Json = {
        ...items[position],
        humanTaskId: await this.next(),
        batchId: b.batchId,
        groupSessionId: b.groupSessionId,
        initiatorUserId: this.actor,
        status: "PENDING",
        revision: 0,
        latestVersion: 0,
        position,
        createdAt: now(),
      };
      await insert(this.db, "byai_group_human_task", {
        human_task_id: t.humanTaskId,
        enterprise_id: this.tenant,
        group_session_id: t.groupSessionId,
        batch_id: t.batchId,
        initiator_user_id: this.actor,
        assignee_user_id: t.assigneeUserId,
        status: t.status,
        revision: 0,
        latest_version: 0,
        payload: JSON.stringify(t),
        create_time: new Date(),
        update_time: new Date(),
      });
    }
  }
  private async task(id: string): Promise<Json> {
    const task = parsed(
      await first(
        this.db,
        "SELECT payload FROM byai.byai_group_human_task WHERE enterprise_id=$1 AND human_task_id=$2",
        [this.tenant, id],
      ),
    );
    check(task, "NOT_FOUND");
    return task;
  }
  private async list(body: Json): Promise<Json> {
    const size = body.pageSize ?? 20,
      page = body.pageNum ?? 1;
    check(
      Number.isInteger(size) &&
        size > 0 &&
        size <= 100 &&
        Number.isInteger(page) &&
        page > 0 &&
        page <= 1000000,
      "INVALID_PAGE",
    );
    let condition =
      body.relation === "INITIATED"
        ? "initiator_user_id=$2"
        : body.relation === "ASSIGNED"
          ? "assignee_user_id=$2"
          : "(initiator_user_id=$2 OR assignee_user_id=$2)";
    const args: unknown[] = [this.tenant, this.actor];
    let filter = "";
    if (body.view != null) {
      // Business views replace legacy filters; self-assigned tasks only enter the initiator's review view.
      condition = viewPredicate(body.view);
    } else if (body.status != null) {
      args.push(body.status);
      filter = " AND status=$3";
    }
    const where = `WHERE enterprise_id=$1 AND ${condition}${filter}${groupFilter(body, args)}`;
    const count = await first(
      this.db,
      `SELECT COUNT(*) AS total FROM byai.byai_group_human_task ${where}`,
      args,
    );
    const items = await this.db.query(
      `SELECT payload FROM byai.byai_group_human_task ${where} ORDER BY human_task_id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, (page - 1) * size],
    );
    return { items: items.map((row) => JSON.parse(row.payload)), total: Number(count!.total) };
  }
  private async groupList(body: Json): Promise<Json> {
    const group = taskId(body, "groupSessionId");
    check(await this.member(group, "USER", this.actor), "GROUP_SCOPE_MISMATCH");
    const size = body.pageSize ?? 20,
      page = body.pageNum ?? 1;
    check(
      Number.isInteger(size) &&
        size > 0 &&
        size <= 100 &&
        Number.isInteger(page) &&
        page > 0 &&
        page <= 1000000,
      "INVALID_PAGE",
    );
    const args: unknown[] = [this.tenant, group];
    const conditions = ["enterprise_id=$1", "group_session_id=$2"];
    if (body.status != null) {
      check(
        ["PENDING", "PENDING_REVIEW", "CHANGES_REQUESTED", "ACCEPTED"].includes(body.status),
        "INVALID_STATUS",
      );
      args.push(body.status);
      conditions.push(`status=$${args.length}`);
    }
    // Only the caller needs current membership; historical initiators and assignees remain valid filters.
    for (const [field, column] of [
      ["initiatorUserIds", "initiator_user_id"],
      ["assigneeUserIds", "assignee_user_id"],
    ] as const) {
      if (body[field] == null) continue;
      check(Array.isArray(body[field]), `INVALID_${field}`);
      const ids = [
        ...new Set<string>(body[field].map((id: unknown) => taskId({ [field]: id }, field))),
      ];
      check(ids.length <= 100, `INVALID_${field}`);
      if (!ids.length) continue;
      const placeholders = ids.map((id) => {
        args.push(id);
        return `$${args.length}`;
      });
      conditions.push(`${column} IN (${placeholders.join(",")})`);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const count = await first(
      this.db,
      `SELECT COUNT(*) AS total FROM byai.byai_group_human_task ${where}`,
      args,
    );
    const items = await this.db.query(
      `SELECT payload FROM byai.byai_group_human_task ${where} ORDER BY human_task_id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, (page - 1) * size],
    );
    // Task payloads contain requirements and state pointers; submission and review histories stay separate.
    return { items: items.map((row) => JSON.parse(row.payload)), total: Number(count!.total) };
  }
  private async counts(body: Json): Promise<Json> {
    const args: unknown[] = [this.tenant, this.actor];
    const filter = groupFilter(body, args);
    // Aggregate stored columns in one snapshot; page filters and potentially large payloads are irrelevant.
    const counts = (await first(
      this.db,
      `SELECT
        COALESCE(SUM(CASE WHEN ${viewPredicate("PENDING_REVIEW")} THEN 1 ELSE 0 END),0) AS pending_review,
        COALESCE(SUM(CASE WHEN ${viewPredicate("PENDING_COMPLETION")} THEN 1 ELSE 0 END),0) AS pending_completion,
        COALESCE(SUM(CASE WHEN ${viewPredicate("PENDING_MODIFICATION")} THEN 1 ELSE 0 END),0) AS pending_modification
       FROM byai.byai_group_human_task
       WHERE enterprise_id=$1 AND (initiator_user_id=$2 OR assignee_user_id=$2)${filter}`,
      args,
    ))!;
    // PostgreSQL returns BIGINT aggregates as strings; expose JSON numbers consistently.
    const pendingReview = Number(counts.pendingReview);
    const pendingCompletion = Number(counts.pendingCompletion);
    return {
      pendingReview,
      pendingCompletion,
      pendingModification: Number(counts.pendingModification),
      // Modification is a subset of completion, so it must not be counted again.
      total: pendingReview + pendingCompletion,
    };
  }
  private async binding(session: string): Promise<Json | null> {
    const row = await first(
      this.db,
      "SELECT b.human_task_id,b.entry_type,s.object_id FROM byai.byai_group_human_task_session b JOIN byai.byai_session s ON s.session_id=b.task_session_id AND s.enterprise_id=b.enterprise_id WHERE b.enterprise_id=$1 AND b.task_session_id=$2",
      [this.tenant, session],
    );
    if (!row) return null;
    const scope = await readGroupCoordination(this.db, session);
    return {
      humanTaskId: String(row.humanTaskId),
      taskSessionId: session,
      entryType: row.entryType,
      groupSessionId: (await this.task(String(row.humanTaskId))).groupSessionId,
      targetAgentId: String(row.objectId),
      ...(scope ? { groupCoordination: scope } : {}),
    };
  }
  private async createSession(body: Json): Promise<Json> {
    const t = await this.task(taskId(body, "humanTaskId"));
    check(body.entryType === "PRIVATE", "INVALID_ENTRY_TYPE");
    check(!(body.agentId != null && body.agentIds != null), "INVALID_AGENT_IDS");
    const rawAgents = body.agentIds ?? [body.agentId];
    check(Array.isArray(rawAgents) && rawAgents.length > 0, "INVALID_AGENT_IDS");
    // Canonical selection order makes duplicate mentions and reordered retries the same request.
    const agents = [
      ...new Set<string>(
        rawAgents.map((value: unknown) =>
          taskId({ agentId: typeof value === "string" ? value.trim() : value }, "agentId"),
        ),
      ),
    ].sort((left, right) =>
      BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0,
    );
    check(agents.length <= 100, "INVALID_AGENT_IDS");
    const request = "bind:" + requestId(body);
    const digest = hash({
      humanTaskId: t.humanTaskId,
      requestId: body.requestId,
      entryType: "PRIVATE",
      ...(agents.length === 1 ? { agentId: agents[0] } : { agentIds: agents }),
    });
    const prior = await this.request(t.humanTaskId, request);
    if (prior) {
      const legacy = { ...body };
      delete legacy._resolvedCoordinator;
      // Existing single-employee requests predate canonical selection hashing.
      check(
        prior.payloadHash === digest || prior.payloadHash === hash(legacy),
        "IDEMPOTENCY_MISMATCH",
      );
      if (prior.status === "SESSION_CREATED") {
        const owner = await first(
          this.db,
          "SELECT creator_id FROM byai.byai_session WHERE enterprise_id=$1 AND session_id=$2",
          [this.tenant, prior.result.taskSessionId],
        );
        // Task-scoped request IDs must never expose another participant's private conversation.
        check(owner && String(owner.creatorId) === this.actor, "SESSION_SCOPE_MISMATCH");
        return (await this.binding(prior.result.taskSessionId))!;
      }
    }
    check(t.status !== "ACCEPTED", "ACCEPTED");
    check(await this.member(t.groupSessionId, "USER", this.actor), "GROUP_SCOPE_MISMATCH");
    for (const selected of agents)
      check(await this.member(t.groupSessionId, "AGENT", selected), "AGENT_NOT_GROUP_MEMBER");
    let agent = agents[0]!;
    if (agents.length > 1) {
      const coordinator = await first(
        this.db,
        "SELECT e.ext_param_value FROM byai.byai_session_ext e JOIN byai.byai_session s ON s.session_id=e.session_id WHERE e.session_id=$1 AND e.ext_param_code=$2 AND s.enterprise_id=$3",
        [t.groupSessionId, GROUP_COORDINATOR_AGENT_ID, this.tenant],
      );
      const resolved = body._resolvedCoordinator;
      // Only the authenticated platform can attest resource availability; the tenant still owns membership.
      check(
        coordinator &&
          resolved &&
          typeof resolved === "object" &&
          !Array.isArray(resolved) &&
          resolved.coordinatorAuthorized === true &&
          typeof resolved.coordinatorAgentId === "string" &&
          coordinator.extParamValue === resolved.coordinatorAgentId &&
          /^[1-9][0-9]{0,18}$/.test(resolved.coordinatorAgentId) &&
          BigInt(resolved.coordinatorAgentId) <= 9223372036854775807n,
        "COORDINATOR_UNAVAILABLE",
      );
      agent = resolved.coordinatorAgentId;
      check(await this.member(t.groupSessionId, "AGENT", agent), "COORDINATOR_UNAVAILABLE");
    }
    // New request IDs always open a new conversation; the request's unique record arbitrates retries.
    const group = await first(
      this.db,
      "SELECT project_id FROM byai.byai_session WHERE enterprise_id=$1 AND session_id=$2",
      [this.tenant, t.groupSessionId],
    );
    const session = await this.next();
    await insert(this.db, "byai_session", {
      session_id: session,
      parent_session_id: t.groupSessionId,
      project_id: group?.projectId,
      enterprise_id: this.tenant,
      creator_id: this.actor,
      object_id: agent,
      session_type: "h_as",
      session_name: t.title,
      state: "ACTIVE",
      last_seq: "0",
      create_time: new Date(),
      update_time: new Date(),
    });
    await insert(this.db, "byai_group_chat_task", {
      task_session_id: session,
      group_session_id: t.groupSessionId,
      source_message_id: "0",
      dispatch_id: await this.next(),
      initiator_user_id: this.actor,
      target_agent_id: agent,
      task_name: t.title,
      status: "PRIVATE",
      turn_status: "PRIVATE",
      create_time: new Date(),
      update_time: new Date(),
    });
    for (const [code, value] of [
      ["group_source_session_id", t.groupSessionId],
      ["human_task_id", t.humanTaskId],
    ])
      await insert(this.db, "byai_session_ext", {
        ext_id: await this.next(),
        session_id: session,
        ext_param_name: code,
        ext_param_code: code,
        ext_param_value: value,
      });
    if (agents.length > 1) {
      const scope: GroupCoordination = {
        schemaVersion: "byclaw.group-coordination/v1",
        mode: "COORDINATED",
        groupSessionId: t.groupSessionId,
        taskSessionId: session,
        coordinatorAgentId: agent,
        allowedAgentIds: agents.filter((selected) => selected !== agent),
      };
      await insert(this.db, "byai_session_ext", {
        ext_id: await this.next(),
        session_id: session,
        ext_param_name: GROUP_COORDINATION_SCOPE,
        ext_param_code: GROUP_COORDINATION_SCOPE,
        ext_param_value: JSON.stringify(scope),
      });
    }
    const result = await this.bind({
      humanTaskId: t.humanTaskId,
      taskSessionId: session,
      entryType: "PRIVATE",
    });
    await this.insertRequest(t.humanTaskId, request, digest, {
      status: "SESSION_CREATED",
      payloadHash: digest,
      result,
    });
    return result;
  }
  private async bind(body: Json): Promise<Json> {
    const t = await this.task(taskId(body, "humanTaskId"));
    check(t.status !== "ACCEPTED", "ACCEPTED");
    const mutable = await this.db.query(
      "UPDATE byai.byai_group_human_task SET update_time=update_time WHERE enterprise_id=$1 AND human_task_id=$2 AND status!='ACCEPTED' RETURNING human_task_id",
      [this.tenant, t.humanTaskId],
    );
    check(mutable.length === 1, "ACCEPTED");
    const session = taskId(body, "taskSessionId");
    check(["GROUP", "PRIVATE"].includes(body.entryType), "INVALID_ENTRY_TYPE");
    const execution = await first(
      this.db,
      "SELECT s.creator_id,s.object_id,s.parent_session_id,t.group_session_id FROM byai.byai_session s JOIN byai.byai_group_chat_task t ON t.task_session_id=s.session_id WHERE s.enterprise_id=$1 AND s.session_id=$2",
      [this.tenant, session],
    );
    check(
      execution &&
        String(execution.creatorId) === this.actor &&
        String(execution.parentSessionId) === t.groupSessionId &&
        String(execution.groupSessionId) === t.groupSessionId,
      "SESSION_SCOPE_MISMATCH",
    );
    check(
      await this.member(t.groupSessionId, "AGENT", String(execution.objectId)),
      "AGENT_NOT_GROUP_MEMBER",
    );
    if (body.entryType === "PRIVATE") {
      const ordinary = await first(
        this.db,
        "SELECT 1 FROM byai.byai_group_chat_direct_binding WHERE task_session_id=$1",
        [session],
      );
      check(!ordinary, "ORDINARY_PRIVATE_SESSION");
    }
    const old = await this.binding(session);
    if (old) {
      check(old.humanTaskId === t.humanTaskId, "SESSION_ALREADY_BOUND");
      return old;
    }
    await this.db.query(
      "INSERT INTO byai.byai_group_human_task_session(task_session_id,enterprise_id,human_task_id,entry_type,create_time) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT(task_session_id) DO NOTHING",
      [session, this.tenant, t.humanTaskId, body.entryType],
    );
    const result = await this.binding(session);
    check(result?.humanTaskId === t.humanTaskId, "SESSION_ALREADY_BOUND");
    return result!;
  }
  private async request(id: string, req: string): Promise<Json | null> {
    await this.task(id);
    return parsed(
      await first(
        this.db,
        "SELECT payload FROM byai.byai_group_human_task_submit_request WHERE human_task_id=$1 AND request_id=$2",
        [id, req],
      ),
    );
  }
  private async checkpoint(body: Json): Promise<Json> {
    const id = taskId(body, "humanTaskId"),
      req = requestId(body),
      digest = body.payloadHash;
    await this.task(id);
    check(typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest), "INVALID_PAYLOAD_HASH");
    const value = { status: "UPLOADING", payloadHash: digest, payload: body.payload ?? {} };
    await this.insertRequest(id, req, digest, value);
    const old = await this.request(id, req);
    check(old?.payloadHash === digest, "IDEMPOTENCY_MISMATCH");
    if (old.status === "SUCCEEDED") return old;
    await this.db.query(
      'UPDATE byai.byai_group_human_task_submit_request SET payload=$1,revision=revision+1,update_time=CURRENT_TIMESTAMP WHERE human_task_id=$2 AND request_id=$3 AND payload_hash=$4 AND payload NOT LIKE \'%"status":"SUCCEEDED"%\'',
      [JSON.stringify(value), id, req, digest],
    );
    return (await this.request(id, req))!;
  }
  private async insertRequest(id: string, req: string, digest: string, value: Json): Promise<void> {
    await this.db.query(
      "INSERT INTO byai.byai_group_human_task_submit_request(human_task_id,request_id,payload_hash,payload,revision,create_time,update_time) VALUES($1,$2,$3,$4,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(human_task_id,request_id) DO NOTHING",
      [id, req, digest, JSON.stringify(value)],
    );
  }
  private async updateTask(task: Json, expected: number): Promise<void> {
    const rows = await this.db.query(
      "UPDATE byai.byai_group_human_task SET status=$1,revision=$2,latest_version=$3,latest_submission_id=$4,payload=$5,update_time=CURRENT_TIMESTAMP WHERE enterprise_id=$6 AND human_task_id=$7 AND revision=$8 AND status!='ACCEPTED' RETURNING human_task_id",
      [
        task.status,
        task.revision,
        task.latestVersion,
        task.latestSubmissionId ?? null,
        JSON.stringify(task),
        this.tenant,
        task.humanTaskId,
        expected,
      ],
    );
    check(rows.length === 1, "STATE_CHANGED");
  }
  private async submit(body: Json): Promise<Json> {
    const id = taskId(body, "humanTaskId"),
      req = requestId(body),
      digest = body.payloadHash ?? hash(body);
    const old = await this.request(id, req);
    if (old) {
      check(old.payloadHash === digest, "IDEMPOTENCY_MISMATCH");
      if (old.status === "SUCCEEDED") return old.result;
    }
    const t = await this.task(id);
    requireSubmission(t, body);
    check(
      ["DIRECT", "GROUP", "PRIVATE", "SESSION"].includes(body.sourceType),
      "INVALID_SOURCE_TYPE",
    );
    let session: string | null = null,
      pending: string | null = null;
    if (body.sourceType !== "DIRECT") {
      session = taskId(body, "taskSessionId");
      pending = taskId(body, "pendingPublicationId");
      check((await this.binding(session))?.humanTaskId === id, "SESSION_NOT_BOUND");
    }
    const version = t.latestVersion + 1,
      result: Json = {
        submissionId: await this.next(),
        humanTaskId: id,
        version,
        status: "PENDING_REVIEW",
        text: (body.text ?? "").trim(),
        files: body.files ?? [],
        sourceType: body.sourceType,
        taskSessionId: session,
        submitterUserId: this.actor,
        createdAt: now(),
      };
    const rev = t.revision;
    t.latestVersion = version;
    t.latestSubmissionId = result.submissionId;
    t.status = "PENDING_REVIEW";
    t.revision++;
    await this.updateTask(t, rev);
    if (session) {
      const removed = await this.db.query(
        "DELETE FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1 AND pending_publication_id=$2 RETURNING pending_publication_id",
        [session, pending],
      );
      check(removed.length === 1, "STALE_PUBLICATION");
    }
    await insert(this.db, "byai_group_human_task_submission", {
      submission_id: result.submissionId,
      enterprise_id: this.tenant,
      human_task_id: id,
      version_no: version,
      request_id: req,
      payload_hash: digest,
      payload: JSON.stringify(result),
      create_time: new Date(),
    });
    const recorded = {
      status: "SUCCEEDED",
      payloadHash: digest,
      payload: old?.payload ?? {},
      result,
    };
    await this.insertRequest(id, req, digest, recorded);
    const updated = await this.db.query(
      "UPDATE byai.byai_group_human_task_submit_request SET payload=$1,revision=revision+1,update_time=CURRENT_TIMESTAMP WHERE human_task_id=$2 AND request_id=$3 AND payload_hash=$4 RETURNING human_task_id",
      [JSON.stringify(recorded), id, req, digest],
    );
    check(updated.length === 1, "IDEMPOTENCY_MISMATCH");
    return result;
  }
  private async review(body: Json): Promise<Json> {
    const id = taskId(body, "humanTaskId"),
      req = requestId(body),
      digest = hash(body);
    const old = parsed(
      await first(
        this.db,
        "SELECT payload FROM byai.byai_group_human_task_review WHERE enterprise_id=$1 AND human_task_id=$2 AND request_id=$3",
        [this.tenant, id, req],
      ),
    );
    if (old) {
      check(old.payloadHash === digest, "IDEMPOTENCY_MISMATCH");
      return old;
    }
    const t = await this.task(id);
    requireReview(t, body);
    const rev = t.revision;
    t.status = body.decision === "ACCEPT" ? "ACCEPTED" : "CHANGES_REQUESTED";
    t.revision++;
    await this.updateTask(t, rev);
    const result = {
      reviewId: await this.next(),
      humanTaskId: id,
      submissionId: body.submissionId,
      decision: body.decision,
      opinion: (body.opinion ?? "").trim(),
      reviewerUserId: this.actor,
      createdAt: now(),
      status: t.status,
      revision: t.revision,
      payloadHash: digest,
    };
    await insert(this.db, "byai_group_human_task_review", {
      review_id: result.reviewId,
      enterprise_id: this.tenant,
      human_task_id: id,
      submission_id: body.submissionId,
      request_id: req,
      payload_hash: digest,
      payload: JSON.stringify(result),
      create_time: new Date(),
    });
    return result;
  }
  private async history(id: string): Promise<Json> {
    const t = await this.task(id);
    const reviews = (
      await this.db.query(
        "SELECT payload FROM byai.byai_group_human_task_review WHERE enterprise_id=$1 AND human_task_id=$2 ORDER BY review_id DESC",
        [this.tenant, id],
      )
    ).map((row) => JSON.parse(row.payload));
    const submissions = (
      await this.db.query(
        "SELECT payload FROM byai.byai_group_human_task_submission WHERE enterprise_id=$1 AND human_task_id=$2 ORDER BY version_no DESC",
        [this.tenant, id],
      )
    ).map((row) => JSON.parse(row.payload));
    return {
      items: submissions.map((item) => ({
        ...item,
        superseded: item.submissionId !== t.latestSubmissionId,
        reviews: reviews.filter((review) => review.submissionId === item.submissionId),
      })),
    };
  }
  private async senderName(batch: Json): Promise<string | null> {
    const member = await first(
      this.db,
      "SELECT mem_name FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type=$2 AND mem_obj_id=$3 AND com_acct_id=$4",
      [batch.groupSessionId, batch.senderType, batch.senderId, this.tenant],
    );
    return member?.memName ?? null;
  }
  private async message(batch: Json, kind: string, id: string): Promise<void> {
    const agent = batch.senderType === "AGENT";
    // Preserve the proposal's name when membership later changes; older payloads may lack a snapshot.
    const name = Object.hasOwn(batch, "senderName")
      ? batch.senderName
      : await this.senderName(batch);
    // Timeline projection reads usage and agent associations, not creator_id alone.
    await insert(this.db, "byai_message", {
      id,
      message_id: id,
      session_id: batch.groupSessionId,
      enterprise_id: this.tenant,
      creator_id: batch.senderId,
      creator_name: name,
      usage: agent ? 2 : 1,
      role: agent ? "assistant" : "user",
      res_com_id: agent ? batch.senderId : null,
      message_content: kind === "HUMAN_TASK_PROPOSAL" ? "待办任务提案" : "待办任务",
      metadata: JSON.stringify({
        scene: "GROUP_CHAT",
        kind,
        batchId: batch.batchId,
        ...(agent ? { targetAgentId: batch.senderId } : {}),
      }),
      created_seq: await nextSequence(this.db, this.tenant, batch.groupSessionId),
      is_complete: true,
      msg_status: 0,
      create_time: new Date(),
      update_time: new Date(),
    });
    await indexGroupMessage(this.db, this.tenant, id, null);
  }
}
