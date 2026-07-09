import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { DEFAULTS, METADATA_KEYS, PATHS, PIPELINE, SQLITE } from "./constants.js";
import type { ByclawAcpPlan, ByclawAcpRunRecord } from "./types.js";
import { redactSensitiveJson } from "./redact.js";

const require = createRequire(import.meta.url);

type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes?: number; lastInsertRowid?: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  };
  close(): void;
};

function requireNodeSqlite(): { DatabaseSync: new (pathName: string) => DatabaseSync } {
  try {
    return require("node:sqlite") as { DatabaseSync: new (pathName: string) => DatabaseSync };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`node:sqlite is unavailable in this runtime: ${message}`, { cause: error });
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToRun(row: Record<string, unknown>): ByclawAcpRunRecord {
  return {
    runId: String(row.run_id),
    pipelineRunId: typeof row.pipeline_run_id === "string" ? row.pipeline_run_id : undefined,
    kind: String(row.kind),
    byclawId: String(row.byclaw_id),
    status: String(row.status),
    plan: parseJson<ByclawAcpPlan>(row.plan_json, {} as ByclawAcpPlan),
    input: parseJson(row.input_json, {}),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
    endedAtMs: row.ended_at_ms == null ? undefined : Number(row.ended_at_ms),
    error: typeof row.error === "string" ? row.error : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(source: Record<string, unknown> | undefined, key: string, fallback = ""): string {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function randomSuffix(): string {
  return Math.random()
    .toString(PIPELINE.randomRadix)
    .slice(PIPELINE.randomSliceStart, PIPELINE.randomSliceEnd);
}

function createPipelineRunId(now: number): string {
  const date = new Date(now).toISOString().slice(PIPELINE.isoDateStart, PIPELINE.isoDateEnd);
  return `${PIPELINE.runIdPrefix}-${date}-${now}-${randomSuffix()}`;
}

function createWorkspaceMirrorPath(pipelineRunId: string): string {
  return path.join(PATHS.byclawRunsDir, pipelineRunId);
}

function resolveSource(input: unknown, pipelineRunId: string): Record<string, unknown> {
  if (isRecord(input) && isRecord(input.source)) {
    return input.source;
  }
  return {
    kind: isRecord(input) && typeof input.title === "string" ? PIPELINE.manualSourceKind : PIPELINE.defaultSourceKind,
    id: pipelineRunId,
  };
}

function readMetadataRecord(plan: ByclawAcpPlan, key: string): Record<string, unknown> | undefined {
  const value = plan.metadata?.[key];
  return isRecord(value) ? value : undefined;
}

function readMetadataArray(plan: ByclawAcpPlan, key: string): unknown[] {
  const value = plan.metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function resolveWorkflowSteps(plan: ByclawAcpPlan): Array<Record<string, unknown>> {
  const workflow = readMetadataRecord(plan, METADATA_KEYS.byclawWorkflow);
  const steps = workflow?.steps;
  if (Array.isArray(steps)) {
    return steps.filter(isRecord);
  }
  const claudeTeam = readMetadataRecord(plan, METADATA_KEYS.claudeTeam);
  const agents = Array.isArray(claudeTeam?.agents) ? claudeTeam.agents.filter(isRecord) : [];
  return agents.map((agent, index) => ({
    id: `agent-${index + 1}`,
    name: readString(agent, "name", `Agent ${index + 1}`),
    agentId: readString(agent, "byclawAgentId", ""),
    instruction: `Execute ByClaw role ${readString(agent, "role", PIPELINE.defaultTaskRoleInstructionRole)}.`,
  }));
}

function resolveAgentById(plan: ByclawAcpPlan, agentId: string): Record<string, unknown> | undefined {
  const claudeTeam = readMetadataRecord(plan, METADATA_KEYS.claudeTeam);
  const agents = Array.isArray(claudeTeam?.agents) ? claudeTeam.agents : [];
  return agents.filter(isRecord).find((agent) => readString(agent, "byclawAgentId") === agentId);
}

function taskIdForStep(pipelineRunId: string, step: Record<string, unknown>, index: number): string {
  const raw = readString(step, "id", `step-${index + 1}`);
  const normalized = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${pipelineRunId}${PIPELINE.taskIdSeparator}${normalized || `step-${index + 1}`}`;
}

function buildLoopContract(plan: ByclawAcpPlan, input: unknown): Record<string, unknown> {
  const loop = readMetadataRecord(plan, METADATA_KEYS.byclawLoop);
  const workflow = readMetadataRecord(plan, METADATA_KEYS.byclawWorkflow);
  const team = readMetadataRecord(plan, METADATA_KEYS.byclawTeam);
  return {
    loopId: readString(loop, "id", plan.id),
    goal: isRecord(input) ? (input.goal ?? input.title ?? plan.name) : plan.name,
    cadence: loop?.cadence ?? PIPELINE.loopContract.cadence,
    actor: PIPELINE.loopContract.actor,
    state: {
      flow: PIPELINE.loopContract.stateFlow,
      tasks: PIPELINE.loopContract.stateTasks,
      mirror: PIPELINE.loopContract.stateMirror,
    },
    makers: PIPELINE.loopContract.makers,
    checkers: PIPELINE.loopContract.checkers,
    workflowId: readString(workflow, "id", ""),
    teamId: readString(team, "id", ""),
    exitCriteria: Array.isArray(loop?.exitCriteria) ? loop.exitCriteria : [],
    budget: loop?.budget ?? { maxAgentTurns: PIPELINE.loopContract.maxAgentTurns },
    humanEscalation: isRecord(loop?.budget) ? loop.budget.humanEscalation : undefined,
  };
}

export class ByclawAcpRunStore {
  private readonly db: DatabaseSync;

  constructor(private readonly sqlitePath: string) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    const { DatabaseSync: SqliteDatabase } = requireNodeSqlite();
    this.db = new SqliteDatabase(sqlitePath);
    this.ensureSchema();
  }

  createRun(params: { plan: ByclawAcpPlan; input: unknown }): ByclawAcpRunRecord {
    const now = Date.now();
    const runId = `${PIPELINE.acpRunIdPrefix}-${now}-${randomSuffix()}`;
    const pipelineRunId = createPipelineRunId(now);
    const plan = redactSensitiveJson(params.plan);
    const input = redactSensitiveJson(params.input ?? {});
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.createPipelineState({ pipelineRunId, acpRunId: runId, plan, input, now });
      this.db
        .prepare(
          `INSERT INTO byclaw_acp_runs
            (run_id, pipeline_run_id, kind, byclaw_id, status, plan_json, input_json, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          pipelineRunId,
          plan.kind,
          plan.id,
          PIPELINE.statuses.planned,
          JSON.stringify(plan),
          JSON.stringify(input),
          now,
          now,
        );
      this.appendEvent(runId, PIPELINE.statuses.planned, { plan, pipelineRunId });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`Failed to create ACP run ${runId}.`);
    }
    return run;
  }

  private createPipelineState(params: {
    pipelineRunId: string;
    acpRunId: string;
    plan: ByclawAcpPlan;
    input: unknown;
    now: number;
  }): void {
    const { pipelineRunId, acpRunId, plan, input, now } = params;
    const workspaceMirrorPath = createWorkspaceMirrorPath(pipelineRunId);
    const source = resolveSource(input, pipelineRunId);
    const humanGateState = {
      currentGate: PIPELINE.defaultHumanGate,
      required: true,
      decision: null,
    };
    const loopContract = buildLoopContract(plan, input);
    const workflow = readMetadataRecord(plan, METADATA_KEYS.byclawWorkflow);
    const team = readMetadataRecord(plan, METADATA_KEYS.byclawTeam);
    const workboardBoardId = readString(team, "id", PIPELINE.defaultWorkboardBoardId);
    const flowId = `${PIPELINE.flowIdPrefix}-${pipelineRunId}`;

    this.db
      .prepare(
        `INSERT INTO byclaw_pipeline_runs
          (id, source_json, status, flow_id, workboard_board_id, human_gate_state_json,
           loop_contract_json, workspace_mirror_path, plan_json, input_json, acp_run_id,
           created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pipelineRunId,
        JSON.stringify(source),
        PIPELINE.statuses.planning,
        flowId,
        workboardBoardId,
        JSON.stringify(humanGateState),
        JSON.stringify(loopContract),
        workspaceMirrorPath,
        JSON.stringify(plan),
        JSON.stringify(input ?? {}),
        acpRunId,
        now,
        now,
      );

    this.appendTaskEvent({
      pipelineRunId,
      taskId: null,
      eventType: PIPELINE.events.pipelineRunCreated,
      event: {
        status: PIPELINE.statuses.planning,
        flowId,
        workboardBoardId,
        workspaceMirrorPath,
        workflowId: readString(workflow, "id", ""),
      },
      now,
    });

    const steps = resolveWorkflowSteps(plan);
    steps.forEach((step, index) => {
      const taskId = taskIdForStep(pipelineRunId, step, index);
      const agentId = readString(step, "agentId", "");
      const agent = resolveAgentById(plan, agentId);
      const role = readString(agent, "role", readString(step, "role", readString(step, "id", PIPELINE.defaultTaskRole)));
      const ownerAgent = readString(agent, "name", `byclaw-${role}`);
      const dependencies = index === 0 ? [] : [taskIdForStep(pipelineRunId, steps[index - 1] ?? {}, index - 1)];
      const claim = {
        ownerId: ownerAgent,
        expiresAt: new Date(now + PIPELINE.claimTtlMs).toISOString(),
      };
      const proofPath = path.posix.join(
        workspaceMirrorPath,
        PATHS.proofDir,
        `${readString(step, "id", `step-${index + 1}`)}.json`,
      );
      this.db
        .prepare(
          `INSERT INTO byclaw_pipeline_tasks
            (id, pipeline_run_id, role, owner_agent, workboard_card_id, step_id, status,
             instruction, dependencies_json, claim_json, proof_json, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          taskId,
          pipelineRunId,
          role,
          ownerAgent,
          readString(step, "id", taskId),
          readString(step, "id", `step-${index + 1}`),
          index === 0 ? PIPELINE.statuses.ready : PIPELINE.statuses.proposed,
          readString(step, "instruction", ""),
          JSON.stringify(dependencies),
          JSON.stringify(claim),
          JSON.stringify([proofPath]),
          now,
          now,
        );
      this.appendTaskEvent({
        pipelineRunId,
        taskId,
        eventType: PIPELINE.events.pipelineTaskCreated,
        event: { role, ownerAgent, step, dependencies, claim, proof: [proofPath] },
        now,
      });
    });

    this.db
      .prepare(
        `INSERT INTO byclaw_shared_artifacts
          (pipeline_run_id, task_id, kind, path, source, owner, checksum, visibility, artifact_json, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pipelineRunId,
        null,
        PIPELINE.artifact.kind,
        path.posix.join(workspaceMirrorPath, PATHS.stateSnapshotFileName),
        PIPELINE.artifact.source,
        PIPELINE.artifact.owner,
        "",
        PIPELINE.artifact.visibility,
        JSON.stringify({ generatedFrom: PIPELINE.artifact.generatedFrom, authority: PIPELINE.artifact.authority }),
        now,
      );
  }

  private appendTaskEvent(params: {
    pipelineRunId: string;
    taskId: string | null;
    eventType: string;
    event: unknown;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO byclaw_task_events
          (pipeline_run_id, task_id, event_type, event_json, created_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        params.pipelineRunId,
        params.taskId,
        params.eventType,
        JSON.stringify(redactSensitiveJson(params.event ?? {})),
        params.now ?? Date.now(),
      );
  }

  listRuns(limit = DEFAULTS.runListLimit): ByclawAcpRunRecord[] {
    return this.db
      .prepare("SELECT * FROM byclaw_acp_runs ORDER BY created_at_ms DESC LIMIT ?")
      .all(Math.max(DEFAULTS.minRunListLimit, Math.min(DEFAULTS.maxRunListLimit, Math.trunc(limit))))
      .map(rowToRun);
  }

  getRun(runId: string): ByclawAcpRunRecord | undefined {
    const row = this.db.prepare("SELECT * FROM byclaw_acp_runs WHERE run_id = ?").get(runId);
    return row ? rowToRun(row) : undefined;
  }

  appendEvent(runId: string, eventType: string, event: unknown): void {
    this.db
      .prepare(
        `INSERT INTO byclaw_acp_events (run_id, event_type, event_json, created_at_ms)
         VALUES (?, ?, ?, ?)`,
      )
      .run(runId, eventType, JSON.stringify(redactSensitiveJson(event ?? {})), Date.now());
  }

  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = ${SQLITE.journalMode};
      PRAGMA busy_timeout = ${SQLITE.busyTimeoutMs};
      CREATE TABLE IF NOT EXISTS byclaw_acp_runs (
        run_id TEXT PRIMARY KEY,
        pipeline_run_id TEXT,
        kind TEXT NOT NULL,
        byclaw_id TEXT NOT NULL,
        status TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        input_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_byclaw_acp_runs_created
        ON byclaw_acp_runs(created_at_ms DESC);
      CREATE TABLE IF NOT EXISTS byclaw_acp_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_byclaw_acp_events_run
        ON byclaw_acp_events(run_id, created_at_ms);
      CREATE TABLE IF NOT EXISTS byclaw_pipeline_runs (
        id TEXT PRIMARY KEY,
        source_json TEXT NOT NULL,
        status TEXT NOT NULL,
        flow_id TEXT NOT NULL,
        workboard_board_id TEXT NOT NULL,
        human_gate_state_json TEXT NOT NULL,
        loop_contract_json TEXT NOT NULL,
        workspace_mirror_path TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        input_json TEXT NOT NULL,
        acp_run_id TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_byclaw_pipeline_runs_created
        ON byclaw_pipeline_runs(created_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_byclaw_pipeline_runs_status
        ON byclaw_pipeline_runs(status, updated_at_ms DESC);
      CREATE TABLE IF NOT EXISTS byclaw_pipeline_tasks (
        id TEXT PRIMARY KEY,
        pipeline_run_id TEXT NOT NULL,
        role TEXT NOT NULL,
        owner_agent TEXT NOT NULL,
        workboard_card_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL,
        instruction TEXT NOT NULL,
        dependencies_json TEXT NOT NULL,
        claim_json TEXT NOT NULL,
        proof_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_byclaw_pipeline_tasks_run
        ON byclaw_pipeline_tasks(pipeline_run_id, created_at_ms);
      CREATE INDEX IF NOT EXISTS idx_byclaw_pipeline_tasks_status
        ON byclaw_pipeline_tasks(status, updated_at_ms DESC);
      CREATE TABLE IF NOT EXISTS byclaw_btw_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pipeline_run_id TEXT NOT NULL,
        task_id TEXT,
        type TEXT NOT NULL,
        from_ref TEXT NOT NULL,
        target_json TEXT NOT NULL,
        instruction TEXT NOT NULL,
        decision TEXT,
        expires_at TEXT,
        audit_ref TEXT,
        event_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_byclaw_btw_events_target
        ON byclaw_btw_events(pipeline_run_id, task_id, created_at_ms);
      CREATE TABLE IF NOT EXISTS byclaw_shared_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pipeline_run_id TEXT NOT NULL,
        task_id TEXT,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        source TEXT NOT NULL,
        owner TEXT NOT NULL,
        checksum TEXT,
        visibility TEXT NOT NULL,
        artifact_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_byclaw_shared_artifacts_run
        ON byclaw_shared_artifacts(pipeline_run_id, kind, created_at_ms);
      CREATE TABLE IF NOT EXISTS byclaw_task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pipeline_run_id TEXT NOT NULL,
        task_id TEXT,
        event_type TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_byclaw_task_events_run
        ON byclaw_task_events(pipeline_run_id, task_id, created_at_ms);
    `);
    this.ensureColumn("byclaw_acp_runs", "pipeline_run_id", "TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_byclaw_acp_runs_pipeline
        ON byclaw_acp_runs(pipeline_run_id);
    `);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (rows.some((row) => row.name === column)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
