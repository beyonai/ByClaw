import {
  createPiSessionCheckpoint,
  fingerprintGroupChatContext,
  isThinkingLevel,
  LEADER_CHECKPOINT_TOOL_NAMES,
  parseSessionContext,
  parseGroupChatContext,
  parseExpertTeamRuntimeSnapshot,
  validatePiSessionCheckpoint,
  type AgentCapabilityCardRepository,
  type AgentCapabilityCardUpsert,
  type CallerPrincipal,
  type CallbackTimeoutDelivery,
  type Delegation,
  type DelegationRepository,
  type ExecutionCredential,
  type ExecutionCredentialRepository,
  type IngressSessionBindingRepository,
  type JsonValue,
  type LeaderCheckpointStore,
  type PiSessionCheckpoint,
  type Run,
  type RunAttachment,
  type RunIngressContextV1,
  type RunEvent,
  type RunEventStore,
  type RunExecutionClaim,
  type RunExecutionQueue,
  type RunPage,
  type RunRepository,
  type Session,
  type SessionRepository,
} from "@byclaw/by-conductor";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from "pg";
import {
  POSTGRES_TABLE_PREFIX,
  POSTGRES_MIGRATIONS,
} from "./migrations.js";

const NON_TERMINAL_RUN_STATUSES = [
  "CREATED",
  "QUEUED",
  "RUNNING",
  "WAITING_AGENT",
  "WAITING_USER",
  "SYNTHESIZING",
  "CANCELLING",
] as const;
/** WAITING_AGENT 只能由可信 Resume 回调显式改回 QUEUED，不能被轮询器空转重领。 */
const CLAIMABLE_RUN_STATUSES = NON_TERMINAL_RUN_STATUSES.filter(
  (status) => status !== "WAITING_AGENT",
);
const TERMINAL_EVENT_TYPES = new Set([
  "run.completed",
  "run.failed",
  "run.cancelled",
]);
const ALLOWED_PI_TOOL_NAMES = new Set<string>(LEADER_CHECKPOINT_TOOL_NAMES);

export interface PostgresDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  statementTimeoutMs?: number;
  ssl?: boolean | PoolConfig["ssl"];
  eventPollMs?: number;
  /** OpenGauss 等兼容库可关闭 LISTEN，事件流仍使用数据库 cursor 轮询补查。 */
  eventListenEnabled?: boolean;
  piEntryMaxBytes?: number;
  piSessionMaxBytes?: number;
  piSessionMaxEntries?: number;
}

export interface PostgresSchemaStatus {
  healthy: boolean;
  message?: string;
}

/**
 * PostgreSQL 连接、迁移和各持久化 Port 的统一入口。
 * schema 名在构造时严格校验；所有业务值仍通过参数化查询传入。
 */
export class PostgresDatabase {
  readonly pool: Pool;
  readonly schema: string;
  readonly sessions: PostgresSessionRepository;
  readonly runs: PostgresRunRepository;
  readonly delegations: PostgresDelegationRepository;
  readonly events: PostgresRunEventStore;
  readonly bindings: PostgresIngressSessionBindingRepository;
  readonly queue: PostgresRunExecutionQueue;
  readonly checkpoints: PostgresLeaderCheckpointStore;
  readonly credentials: PostgresExecutionCredentialRepository;
  readonly capabilityCards: PostgresAgentCapabilityCardRepository;

  constructor(config: PostgresDatabaseConfig) {
    this.schema = safeIdentifier(config.schema, "DB_SCHEMA");
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.maxConnections ?? 20,
      connectionTimeoutMillis: config.connectionTimeoutMs ?? 5_000,
      idleTimeoutMillis: config.idleTimeoutMs ?? 30_000,
      statement_timeout: config.statementTimeoutMs ?? 30_000,
      ...(config.ssl === undefined ? {} : { ssl: config.ssl }),
    });
    this.sessions = new PostgresSessionRepository(this.pool, this.schema);
    this.runs = new PostgresRunRepository(this.pool, this.schema);
    this.delegations = new PostgresDelegationRepository(this.pool, this.schema);
    this.events = new PostgresRunEventStore(
      this.pool,
      this.schema,
      config.eventPollMs ?? 250,
      config.eventListenEnabled ?? true,
    );
    this.bindings = new PostgresIngressSessionBindingRepository(this.pool, this.schema);
    this.queue = new PostgresRunExecutionQueue(this.pool, this.schema);
    this.checkpoints = new PostgresLeaderCheckpointStore(this.pool, this.schema, {
      entryMaxBytes: config.piEntryMaxBytes ?? 1_048_576,
      sessionMaxBytes: config.piSessionMaxBytes ?? 16_777_216,
      sessionMaxEntries: config.piSessionMaxEntries ?? 20_000,
    });
    this.credentials = new PostgresExecutionCredentialRepository(this.pool, this.schema);
    this.capabilityCards = new PostgresAgentCapabilityCardRepository(
      this.pool,
      this.schema,
    );
  }

  /**
   * 幂等执行未应用迁移。生产建议在应用发布前单独调用；
   * advisory transaction lock 防止多个 migration job 并发执行。
   */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quote(this.schema)}`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${table(this.schema, "schema_migrations")} (
          version integer PRIMARY KEY,
          name text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        [`byclaw-super:${this.schema}:migrations`],
      );
      const applied = await client.query<{ version: number }>(
        `SELECT version FROM ${table(this.schema, "schema_migrations")}`,
      );
      const versions = new Set(applied.rows.map((row) => Number(row.version)));
      await client.query(`SET LOCAL search_path TO ${quote(this.schema)}, public`);
      for (const migration of POSTGRES_MIGRATIONS) {
        if (versions.has(migration.version)) {
          continue;
        }
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${table(this.schema, "schema_migrations")}
             (version, name) VALUES ($1, $2)`,
          [migration.version, migration.name],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** 仅检查数据库连通性；表结构由发布前的运维脚本负责。 */
  async health(): Promise<PostgresSchemaStatus> {
    try {
      await this.pool.query("SELECT 1");
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        message: toError(error).message,
      };
    }
  }

  /** 建立 RunEvent LISTEN 连接；失败时 stream 仍会轮询，但 readiness 应报告异常。 */
  async start(): Promise<void> {
    await this.events.start();
  }

  async close(): Promise<void> {
    await this.events.stop();
    await this.pool.end();
  }
}

/**
 * 只负责持久化已编译的 Agent 能力卡。
 * 权限关系不进入此表，也不会由此仓储参与 Leader 的授权 Agent 查询。
 */
export class PostgresAgentCapabilityCardRepository
  implements AgentCapabilityCardRepository
{
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async upsert(input: AgentCapabilityCardUpsert): Promise<void> {
    await transaction(this.pool, async (client) => {
      await advisoryLock(
        client,
        `agent-capability-card:${input.systemCode}:${input.agentId}`,
      );
      const values = [
        input.systemCode,
        input.agentId,
        input.agentCode ?? null,
        input.agentName,
        input.compiled.schemaVersion,
        input.compiled.generatorVersion,
        input.sourceVersion ?? null,
        input.compiled.sourceFingerprint,
        JSON.stringify(input.compiled.card),
        input.compiled.routingText,
        JSON.stringify(input.compiled.quality),
        date(input.now),
      ];
      const updated = await client.query(
        `UPDATE ${table(this.schema, "agent_capability_cards")}
            SET agent_code = $3,
                agent_name = $4,
                schema_version = $5,
                generator_version = $6,
                source_version = $7,
                source_fingerprint = $8,
                card = $9,
                routing_text = $10,
                quality = $11,
                status = 'ACTIVE',
                version = version + 1,
                updated_at = $12
          WHERE system_code = $1
            AND agent_id = $2`,
        values,
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO ${table(this.schema, "agent_capability_cards")}
             (system_code, agent_id, agent_code, agent_name, schema_version,
              generator_version, source_version, source_fingerprint, card,
              routing_text, quality, status, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   'ACTIVE', 0, $12, $12)`,
          values,
        );
      }
    });
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async save(session: Session): Promise<void> {
    await transaction(this.pool, async (client) => {
      await advisoryLock(client, `session:${session.id}`);
      const values = [
        session.id,
        session.owner.userCode,
        session.owner.userName ?? null,
        JSON.stringify(session.sessionContext),
        session.sessionContextVersion,
        session.contextRevision,
        date(session.createdAt),
        date(session.updatedAt),
      ];
      const updated = await client.query(
        `UPDATE ${table(this.schema, "sessions")}
            SET user_code = $2,
                user_name = $3,
                session_context = $4,
                session_context_version = $5,
                context_revision = $6,
                updated_at = $7
          WHERE id = $1`,
        [
          session.id,
          session.owner.userCode,
          session.owner.userName ?? null,
          JSON.stringify(session.sessionContext),
          session.sessionContextVersion,
          session.contextRevision,
          date(session.updatedAt),
        ],
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO ${table(this.schema, "sessions")}
             (id, owner_version, user_code, user_name, status, session_context,
              session_context_version, context_revision, created_at, updated_at)
           VALUES ($1, 1, $2, $3, 'ACTIVE', $4, $5, $6, $7, $8)`,
          values,
        );
      }
    });
  }

  async get(sessionId: string): Promise<Session | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "sessions")} WHERE id = $1`,
      [sessionId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async getOwned(
    sessionId: string,
    owner: CallerPrincipal,
  ): Promise<Session | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "sessions")}
        WHERE id = $1 AND owner_version = 1 AND user_code = $2`,
      [sessionId, owner.userCode],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async delete(sessionId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${table(this.schema, "sessions")}
        WHERE id = $1
          AND NOT EXISTS (
            SELECT 1 FROM ${table(this.schema, "runs")} WHERE session_id = $1
          )`,
      [sessionId],
    );
  }
}

export class PostgresRunRepository implements RunRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async save(run: Run): Promise<void> {
    await transaction(this.pool, async (client) => {
      await writeRun(client, this.schema, run);
    });
  }

  async saveWithEvent(
    run: Run,
    event: Omit<RunEvent, "eventId">,
    claim?: RunExecutionClaim,
  ): Promise<RunEvent> {
    return transaction(this.pool, async (client) => {
      if (claim) {
        await assertLease(client, this.schema, claim);
      }
      await writeRun(client, this.schema, run);
      const stored = await appendRunEvent(client, this.schema, event);
      await notifyRunEvent(client, this.schema, event.runId);
      if (
        run.status === "COMPLETED" ||
        run.status === "FAILED" ||
        run.status === "CANCELLED"
      ) {
        await client.query(
          `DELETE FROM ${table(this.schema, "run_execution_credentials")}
            WHERE run_id = $1`,
          [run.id],
        );
      }
      return stored;
    });
  }

  async createWithEvent(
    run: Run,
    event: Omit<RunEvent, "eventId">,
    credential?: ExecutionCredential,
  ): Promise<RunEvent> {
    return transaction(this.pool, async (client) => {
      await writeRun(client, this.schema, run);
      if (credential) {
        await writeCredential(client, this.schema, credential);
      }
      const stored = await appendRunEvent(client, this.schema, event);
      await notifyRunEvent(client, this.schema, event.runId);
      return stored;
    });
  }

  async createSessionWithRun(
    session: Session,
    run: Run,
    event: Omit<RunEvent, "eventId">,
    credential?: ExecutionCredential,
  ): Promise<RunEvent> {
    return transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO ${table(this.schema, "sessions")}
           (id, owner_version, user_code, user_name, status, session_context,
            session_context_version, context_revision, created_at, updated_at)
         VALUES ($1, 1, $2, $3, 'ACTIVE', $4, $5, $6, $7, $8)`,
        [
          session.id,
          session.owner.userCode,
          session.owner.userName ?? null,
          JSON.stringify(session.sessionContext),
          session.sessionContextVersion,
          session.contextRevision,
          date(session.createdAt),
          date(session.updatedAt),
        ],
      );
      await writeRun(client, this.schema, run);
      if (credential) {
        await writeCredential(client, this.schema, credential);
      }
      const stored = await appendRunEvent(client, this.schema, event);
      await notifyRunEvent(client, this.schema, event.runId);
      return stored;
    });
  }

  async get(runId: string): Promise<Run | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "runs")} WHERE id = $1`,
      [runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  async listBySession(sessionId: string): Promise<Run[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "runs")}
        WHERE session_id = $1 ORDER BY created_at, id`,
      [sessionId],
    );
    return result.rows.map(mapRun);
  }

  async listPageBySession(input: {
    sessionId: string;
    limit: number;
    before?: { createdAt: number; runId: string };
  }): Promise<RunPage> {
    const values: unknown[] = [input.sessionId];
    const beforeClause = input.before
      ? "AND (created_at, id) < ($2, $3)"
      : "";
    if (input.before) {
      values.push(date(input.before.createdAt), input.before.runId);
    }
    values.push(input.limit + 1);
    const result = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "runs")}
        WHERE session_id = $1
          ${beforeClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > input.limit;
    return {
      runs: result.rows
        .slice(0, input.limit)
        .map(mapRun)
        .reverse(),
      hasMore,
    };
  }

  async getOwned(runId: string, owner: CallerPrincipal): Promise<Run | undefined> {
    const result = await this.pool.query(
      `SELECT r.*
         FROM ${table(this.schema, "runs")} r
         JOIN ${table(this.schema, "sessions")} s ON s.id = r.session_id
        WHERE r.id = $1
          AND s.owner_version = 1
          AND s.user_code = $2`,
      [runId, owner.userCode],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }
}

export class PostgresDelegationRepository implements DelegationRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async save(
    delegation: Delegation,
    claim?: RunExecutionClaim,
  ): Promise<void> {
    await transaction(this.pool, async (client) => {
      if (claim) {
        await assertLease(client, this.schema, claim);
      }
      await writeDelegation(client, this.schema, delegation);
    });
  }

  async saveWithEvent(
    delegation: Delegation,
    event: Omit<RunEvent, "eventId">,
    claim?: RunExecutionClaim,
  ): Promise<RunEvent> {
    return transaction(this.pool, async (client) => {
      if (claim) {
        await assertLease(client, this.schema, claim);
      }
      await writeDelegation(client, this.schema, delegation);
      const stored = await appendRunEvent(client, this.schema, event);
      await notifyRunEvent(client, this.schema, event.runId);
      return stored;
    });
  }

  async get(delegationId: string): Promise<Delegation | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "delegations")} WHERE id = $1`,
      [delegationId],
    );
    return result.rows[0] ? mapDelegation(result.rows[0]) : undefined;
  }

  async listByRun(runId: string): Promise<Delegation[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "delegations")}
        WHERE run_id = $1 ORDER BY created_at, id`,
      [runId],
    );
    return result.rows.map(mapDelegation);
  }
}

/**
 * 事件 ID 在单 Run 内递增。数据库轮询始终用于补查，因此实例切换或通知丢失不会漏事件。
 */
export class PostgresRunEventStore implements RunEventStore {
  readonly #waiters = new Map<string, Set<() => void>>();
  #listener: PoolClient | undefined;
  #listenerPromise: Promise<void> | undefined;
  #listenerError: Error | undefined;

  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
    private readonly pollMs = 250,
    private readonly listenEnabled = true,
  ) {}

  async start(): Promise<void> {
    if (!this.listenEnabled) {
      return;
    }
    if (this.#listener) {
      return;
    }
    this.#listenerPromise ??= (async () => {
      const client = await this.pool.connect();
      try {
        client.on("notification", (message) => {
          if (message.channel !== this.#channel() || !message.payload) {
            return;
          }
          this.#wake(message.payload);
        });
        client.on("error", (error) => {
          this.#listenerError = toError(error);
          this.#listener = undefined;
          this.#wakeAll();
        });
        await client.query(`LISTEN ${quote(this.#channel())}`);
        this.#listener = client;
        this.#listenerError = undefined;
      } catch (error) {
        client.release();
        throw error;
      }
    })()
      .catch((error) => {
        this.#listenerError = toError(error);
        throw error;
      })
      .finally(() => {
        this.#listenerPromise = undefined;
      });
    return this.#listenerPromise;
  }

  listenerHealth(): { healthy: boolean; message?: string } {
    if (!this.listenEnabled) {
      return {
        healthy: true,
        message: "LISTEN disabled; RunEvent stream uses database polling",
      };
    }
    return {
      healthy: Boolean(this.#listener) && !this.#listenerError,
      ...(this.#listenerError ? { message: this.#listenerError.message } : {}),
    };
  }

  async stop(): Promise<void> {
    const listener = this.#listener;
    this.#listener = undefined;
    this.#wakeAll();
    if (listener) {
      await listener
        .query(`UNLISTEN ${quote(this.#channel())}`)
        .catch(() => undefined);
      listener.release();
    }
  }

  async append(event: Omit<RunEvent, "eventId">): Promise<RunEvent> {
    return transaction(this.pool, async (client) => {
      const stored = await appendRunEvent(client, this.schema, event);
      await notifyRunEvent(client, this.schema, event.runId);
      return stored;
    });
  }

  async appendForClaim(
    event: Omit<RunEvent, "eventId">,
    claim: RunExecutionClaim,
  ): Promise<RunEvent> {
    return transaction(this.pool, async (client) => {
      await assertExecutableLease(client, this.schema, claim);
      const stored = await appendRunEvent(client, this.schema, event);
      await notifyRunEvent(client, this.schema, event.runId);
      return stored;
    });
  }

  async list(runId: string, afterEventId = 0): Promise<RunEvent[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "run_events")}
        WHERE run_id = $1 AND event_id > $2
        ORDER BY event_id`,
      [runId, afterEventId],
    );
    return result.rows.map(mapRunEvent);
  }

  async *stream(
    runId: string,
    afterEventId = 0,
    signal?: AbortSignal,
  ): AsyncIterable<RunEvent> {
    const batchSize = 500;
    let terminal = false;
    while (!signal?.aborted && !terminal) {
      const events = await this.#listBatch(runId, afterEventId, batchSize);
      for (const event of events) {
        afterEventId = event.eventId;
        terminal ||= TERMINAL_EVENT_TYPES.has(event.type);
        yield event;
      }
      if (terminal || signal?.aborted) {
        return;
      }
      if (events.length === batchSize) {
        continue;
      }
      await this.#waitForWake(runId, signal);
    }
  }

  close(runId: string): void {
    // 终态已经持久化在数据库；这里只唤醒订阅者，避免为历史 Run 保留永久内存集合。
    this.#wake(runId);
  }

  /** SSE 分页读取，慢消费者不会一次把某个 Run 的全部历史事件装入内存。 */
  async #listBatch(
    runId: string,
    afterEventId: number,
    limit: number,
  ): Promise<RunEvent[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "run_events")}
        WHERE run_id = $1 AND event_id > $2
        ORDER BY event_id
        LIMIT $3`,
      [runId, afterEventId, limit],
    );
    return result.rows.map(mapRunEvent);
  }

  async #waitForWake(runId: string, signal?: AbortSignal): Promise<void> {
    // listener 断开时尝试恢复；失败不阻断轮询真源。
    if (
      this.listenEnabled &&
      !this.#listener &&
      !this.#listenerPromise
    ) {
      void this.start().catch(() => undefined);
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const waiters = this.#waiters.get(runId) ?? new Set<() => void>();
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        waiters.delete(finish);
        if (waiters.size === 0) {
          this.#waiters.delete(runId);
        }
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      waiters.add(finish);
      this.#waiters.set(runId, waiters);
      timeout = setTimeout(finish, this.pollMs);
      signal?.addEventListener("abort", finish, { once: true });
      if (signal?.aborted) {
        finish();
      }
    });
  }

  #wake(runId: string): void {
    for (const waiter of this.#waiters.get(runId) ?? []) {
      waiter();
    }
  }

  #wakeAll(): void {
    for (const runId of this.#waiters.keys()) {
      this.#wake(runId);
    }
  }

  #channel(): string {
    return `byclaw_events_${this.schema}`;
  }
}

export class PostgresIngressSessionBindingRepository
implements IngressSessionBindingRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async get(input: {
    source: string;
    userCode: string;
    externalSessionId: string;
  }): Promise<string | undefined> {
    const result = await this.pool.query<{ session_id: string }>(
      `SELECT session_id
         FROM ${table(this.schema, "ingress_session_bindings")}
        WHERE source = $1
          AND owner_version = 1
          AND user_code = $2
          AND external_session_id = $3`,
      [input.source, input.userCode, input.externalSessionId],
    );
    return result.rows[0]?.session_id;
  }

  async bind(input: {
    source: string;
    userCode: string;
    externalSessionId: string;
    sessionId: string;
    now: number;
  }): Promise<void> {
    await transaction(this.pool, async (client) => {
      const values = [
        input.source,
        input.userCode,
        input.externalSessionId,
        input.sessionId,
        date(input.now),
      ];
      await advisoryLock(
        client,
        `binding:${input.source}:${input.userCode}:${input.externalSessionId}`,
      );
      const updated = await client.query(
        `UPDATE ${table(this.schema, "ingress_session_bindings")}
            SET session_id = $4, updated_at = $5
          WHERE source = $1
            AND owner_version = 1
            AND user_code = $2
            AND external_session_id = $3`,
        values,
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO ${table(this.schema, "ingress_session_bindings")} (
             source, owner_version, user_code, external_session_id, session_id,
             created_at, updated_at
           ) VALUES ($1, 1, $2, $3, $4, $5, $5)`,
          values,
        );
      }
    });
  }
}

/**
 * `FOR UPDATE SKIP LOCKED` 领取全局工作；NOT EXISTS 保证只考虑同 Session 最早的非终态 Run。
 * lease upsert 每次接管递增 fencing_token，旧实例后续续约/释放都会失败。
 */
export class PostgresRunExecutionQueue implements RunExecutionQueue {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async enqueue(_run: Run): Promise<void> {
    await this.pool.query("SELECT pg_notify($1, $2)", [
      `byclaw_runs_${this.schema}`,
      "queued",
    ]);
  }

  async claimNext(
    instanceId: string,
    leaseMs: number,
  ): Promise<RunExecutionClaim | undefined> {
    return transaction(this.pool, async (client) => {
      const candidate = await client.query<{
        id: string;
        session_id: string;
        attempt_no: number;
      }>(
        `SELECT r.id, r.session_id, r.attempt_no
           FROM ${table(this.schema, "runs")} r
          WHERE r.status = ANY($1::text[])
            AND NOT EXISTS (
              SELECT 1
                FROM ${table(this.schema, "runs")} earlier
               WHERE earlier.session_id = r.session_id
                 AND earlier.status = ANY($2::text[])
                 AND (earlier.created_at, earlier.id) < (r.created_at, r.id)
            )
            AND NOT EXISTS (
              SELECT 1
                FROM ${table(this.schema, "session_execution_leases")} active
               WHERE active.session_id = r.session_id
                 AND active.lease_expires_at > clock_timestamp()
            )
          ORDER BY r.created_at, r.id
          FOR UPDATE OF r SKIP LOCKED
          LIMIT 1`,
        [CLAIMABLE_RUN_STATUSES, NON_TERMINAL_RUN_STATUSES],
      );
      const row = candidate.rows[0];
      if (!row) {
        return undefined;
      }
      const attemptNo = Number(row.attempt_no) + 1;
      await advisoryLock(client, `lease:${row.session_id}`);
      let lease = await client.query<{
        fencing_token: number | string;
        lease_expires_at: Date | string;
      }>(
        `UPDATE ${table(this.schema, "session_execution_leases")}
            SET owner_instance_id = $2,
                fencing_token = fencing_token + 1,
                lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
                heartbeat_at = clock_timestamp(),
                run_id = $4,
                attempt_no = $5
          WHERE session_id = $1
            AND lease_expires_at <= clock_timestamp()
          RETURNING fencing_token, lease_expires_at`,
        [row.session_id, instanceId, leaseMs, row.id, attemptNo],
      );
      if (lease.rowCount === 0) {
        const existing = await client.query(
          `SELECT 1 FROM ${table(this.schema, "session_execution_leases")}
            WHERE session_id = $1`,
          [row.session_id],
        );
        if (existing.rowCount) {
          return undefined;
        }
        lease = await client.query<{
          fencing_token: number | string;
          lease_expires_at: Date | string;
        }>(
          `INSERT INTO ${table(this.schema, "session_execution_leases")} (
             session_id, owner_instance_id, fencing_token, lease_expires_at,
             heartbeat_at, run_id, attempt_no
           ) VALUES (
             $1, $2, 1, clock_timestamp() + ($3 * interval '1 millisecond'),
             clock_timestamp(), $4, $5
           )
           RETURNING fencing_token, lease_expires_at`,
          [row.session_id, instanceId, leaseMs, row.id, attemptNo],
        );
      }
      const acquired = lease.rows[0];
      if (!acquired) {
        return undefined;
      }
      const fencingToken = integer(acquired.fencing_token);
      await client.query(
        `UPDATE ${table(this.schema, "runs")}
            SET attempt_no = $2,
                lease_fencing_token = $3,
                base_context_revision = (
                  SELECT context_revision
                    FROM ${table(this.schema, "sessions")}
                   WHERE id = $4
                ),
                version = version + 1,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [row.id, attemptNo, fencingToken, row.session_id],
      );
      return {
        runId: row.id,
        sessionId: row.session_id,
        ownerInstanceId: instanceId,
        attemptNo,
        fencingToken,
        leaseExpiresAt: milliseconds(acquired.lease_expires_at),
      };
    });
  }

  async heartbeat(claim: RunExecutionClaim, leaseMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${table(this.schema, "session_execution_leases")}
          SET lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
              heartbeat_at = clock_timestamp()
        WHERE session_id = $1
          AND owner_instance_id = $2
          AND fencing_token = $3
          AND lease_expires_at > clock_timestamp()
          AND EXISTS (
            SELECT 1 FROM ${table(this.schema, "runs")} r
             WHERE r.id = run_id
               AND r.status NOT IN ('CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED')
          )`,
      [
        claim.sessionId,
        claim.ownerInstanceId,
        claim.fencingToken,
        leaseMs,
      ],
    );
    return result.rowCount === 1;
  }

  async release(claim: RunExecutionClaim): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${table(this.schema, "session_execution_leases")}
        WHERE session_id = $1
          AND owner_instance_id = $2
          AND fencing_token = $3`,
      [claim.sessionId, claim.ownerInstanceId, claim.fencingToken],
    );
  }

  /** 原子提交调度挂起边界，避免 Resume 与 WAITING_AGENT 分属两个事务而丢失唤醒。 */
  async suspendRunForDelegation(input: {
    runId: string;
    delegationId: string;
    expectedRunVersion: number;
    claim?: RunExecutionClaim;
  }): Promise<{ runStatus: Run["status"]; suspended: boolean }> {
    return transaction(this.pool, async (client) => {
      if (input.claim) {
        await assertLease(client, this.schema, input.claim);
      }
      // settleWaitingCallback 也采用 event lock -> Delegation/Run row locks，顺序必须一致。
      await lockRunEventSequence(client, input.runId);
      const selected = await client.query<{
        delegation_status: string;
        run_status: Run["status"];
        run_version: number | string;
        suspended_at: Date | string;
      }>(
        `SELECT d.status AS delegation_status, r.status AS run_status,
                r.version AS run_version, clock_timestamp() AS suspended_at
           FROM ${table(this.schema, "delegations")} d
           JOIN ${table(this.schema, "runs")} r ON r.id = d.run_id
          WHERE d.id = $1 AND d.run_id = $2
          FOR UPDATE OF d, r`,
        [input.delegationId, input.runId],
      );
      const row = selected.rows[0];
      if (!row) {
        throw new Error(`Delegation suspension target not found: ${input.delegationId}`);
      }
      const delegationSettled = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(
        row.delegation_status,
      );
      // Resume 先到时已经将 Run 改成 QUEUED；旧执行只退出，绝不再写 WAITING_AGENT。
      if (delegationSettled || row.run_status !== "RUNNING") {
        return { runStatus: row.run_status, suspended: false };
      }
      const runVersion = integer(row.run_version);
      if (runVersion !== input.expectedRunVersion) {
        throw new Error(`Run changed before Delegation suspension: ${input.runId}`);
      }
      const suspendedAt = milliseconds(row.suspended_at);
      const updated = await client.query(
        `UPDATE ${table(this.schema, "runs")}
            SET status = 'WAITING_AGENT', execution_stage = 'CONNECTOR_WAITING',
                version = version + 1, updated_at = $3
          WHERE id = $1 AND version = $2 AND status = 'RUNNING'`,
        [input.runId, runVersion, date(suspendedAt)],
      );
      if (updated.rowCount !== 1) {
        throw new Error(`Run suspension rejected by optimistic lock: ${input.runId}`);
      }
      for (const event of [
        {
          type: "run.status" as const,
          data: { status: "WAITING_AGENT", delegationId: input.delegationId },
        },
        {
          type: "run.suspended" as const,
          data: { status: "WAITING_AGENT", delegationId: input.delegationId },
        },
      ]) {
        await appendRunEvent(client, this.schema, {
          timestamp: suspendedAt,
          runId: input.runId,
          ...event,
        });
      }
      await notifyRunEvent(client, this.schema, input.runId);
      return { runStatus: "WAITING_AGENT", suspended: true };
    });
  }

  /** 多实例安全地终结到期回调；Delegation、Run、事件和投递 Outbox 同事务提交。 */
  async expireWaitingCallbacks(input: {
    limit: number;
  }): Promise<Array<{ runId: string; delegationId: string }>> {
    return transaction(this.pool, async (client) => {
      const candidateRefs = await client.query<{
        delegation_id: string;
        run_id: string;
      }>(
        `SELECT d.id AS delegation_id, d.run_id
           FROM ${table(this.schema, "delegations")} d
           JOIN ${table(this.schema, "runs")} r ON r.id = d.run_id
          WHERE d.status = 'RUNNING'
            AND d.callback_deadline_at IS NOT NULL
            AND d.callback_deadline_at <= clock_timestamp()
            AND r.status = 'WAITING_AGENT'
            AND r.execution_stage = 'CONNECTOR_WAITING'
          ORDER BY d.callback_deadline_at, d.id
          LIMIT $1`,
        [input.limit],
      );
      const expired: Array<{ runId: string; delegationId: string }> = [];
      for (const candidateRef of candidateRefs.rows) {
        // Resume/suspend/timeout 统一使用 event lock -> Delegation/Run row locks。
        // 先无锁找候选，再在锁内重查，避免旧实现 row lock -> event lock 的死锁窗口。
        await lockRunEventSequence(client, candidateRef.run_id);
        const selected = await client.query<{
          delegation_id: string;
          run_id: string;
          agent_id: string;
          agent_name: string | null;
          partial_output: string | null;
          expired_at: Date | string;
        }>(
          `SELECT d.id AS delegation_id, d.run_id, d.agent_id, d.agent_name,
                d.partial_output, clock_timestamp() AS expired_at
           FROM ${table(this.schema, "delegations")} d
           JOIN ${table(this.schema, "runs")} r ON r.id = d.run_id
          WHERE d.id = $1
            AND d.run_id = $2
            AND d.status = 'RUNNING'
            AND d.callback_deadline_at IS NOT NULL
            AND d.callback_deadline_at <= clock_timestamp()
            AND r.status = 'WAITING_AGENT'
            AND r.execution_stage = 'CONNECTOR_WAITING'
          FOR UPDATE OF d, r`,
          [candidateRef.delegation_id, candidateRef.run_id],
        );
        const candidate = selected.rows[0];
        if (!candidate) {
          continue;
        }
        const expiredAt = milliseconds(candidate.expired_at);
        const error = "Delegation received no terminal ResumeCommand within its callback timeout";
        const agentOwner = candidate.agent_name?.trim() || candidate.agent_id;
        const finalAnswer = `${agentOwner} 调度超时：数字员工在规定时间内未返回最终结果。`;
        const result = {
          status: "timed_out",
          output: candidate.partial_output ?? "",
          artifacts: [],
          error,
        };
        await client.query(
          `UPDATE ${table(this.schema, "delegations")}
              SET status = 'TIMED_OUT', result = $2::jsonb, error = $3,
                  version = version + 1, updated_at = $4, finished_at = $4
            WHERE id = $1 AND status = 'RUNNING'`,
          [candidate.delegation_id, JSON.stringify(result), error, date(expiredAt)],
        );
        await client.query(
          `UPDATE ${table(this.schema, "runs")}
              SET status = 'FAILED', execution_stage = 'SETTLED',
                  final_answer = $2, error_message = $3,
                  version = version + 1, updated_at = $4, finished_at = $4
            WHERE id = $1
              AND status = 'WAITING_AGENT'
              AND execution_stage = 'CONNECTOR_WAITING'`,
          [candidate.run_id, finalAnswer, error, date(expiredAt)],
        );
        await appendRunEvent(client, this.schema, {
          timestamp: expiredAt,
          runId: candidate.run_id,
          type: "delegation.failed",
          data: {
            delegationId: candidate.delegation_id,
            agentId: candidate.agent_id,
            ...(candidate.agent_name ? { agentName: candidate.agent_name } : {}),
            status: "TIMED_OUT",
            artifactCount: 0,
            resultStatus: "timed_out",
            hasOutput: Boolean(candidate.partial_output),
            failureStage: "callback_timeout",
            error,
          },
        });
        await appendRunEvent(client, this.schema, {
          timestamp: expiredAt,
          runId: candidate.run_id,
          type: "run.failed",
          data: {
            status: "FAILED",
            delegationId: candidate.delegation_id,
            timedOut: true,
            error,
            userMessage: finalAnswer,
          },
        });
        await client.query(
          `DELETE FROM ${table(this.schema, "run_execution_credentials")}
            WHERE run_id = $1`,
          [candidate.run_id],
        );
        // 同一 Run 的事件锁和 WAITING_AGENT 状态复查保证只有一个扫描事务到达这里；
        // 使用普通 INSERT，避免 openGauss 不支持 PostgreSQL 的 ON CONFLICT 语法。
        await client.query(
          `INSERT INTO ${table(this.schema, "callback_timeout_outbox")} (
             run_id, created_at, updated_at
           ) VALUES ($1, $2, $2)`,
          [candidate.run_id, date(expiredAt)],
        );
        await notifyRunEvent(client, this.schema, candidate.run_id);
        expired.push({
          runId: candidate.run_id,
          delegationId: candidate.delegation_id,
        });
      }
      if (expired.length > 0) {
        await client.query("SELECT pg_notify($1, $2)", [
          `byclaw_runs_${this.schema}`,
          "callback-timeout",
        ]);
      }
      return expired;
    });
  }

  async settleWaitingCallback(input: {
    delegationId: string;
    status: "COMPLETED" | "FAILED" | "CANCELLED";
    finalAnswer: string;
    enforceDeadline?: boolean;
  }): Promise<{ accepted: boolean; runId?: string; wakeRun?: boolean }> {
    return transaction(this.pool, async (client) => {
      // 事件写入会先持有 Run 事件序列锁，再通过外键读取 runs。这里必须采用相同顺序：
      // 先定位 runId 并获取事件锁，再锁 Delegation/Run 行。否则并发 append 可能持有
      // advisory lock 等待 runs 行，而 Resume 持有 runs 行等待 advisory lock，形成 40P01。
      const located = await client.query<{ run_id: string }>(
        `SELECT run_id
           FROM ${table(this.schema, "delegations")}
          WHERE id = $1`,
        [input.delegationId],
      );
      const locatedRunId = located.rows[0]?.run_id;
      if (!locatedRunId) {
        return { accepted: false };
      }
      await lockRunEventSequence(client, locatedRunId);
      const selected = await client.query<{
        delegation_id: string;
        run_id: string;
        agent_id: string;
        agent_name: string | null;
        delegation_status: string;
        run_status: string;
        execution_stage: string;
        callback_expired: boolean;
        settled_at: Date | string;
      }>(
        `SELECT d.id AS delegation_id, d.run_id, d.agent_id, d.agent_name,
                d.status AS delegation_status, r.status AS run_status,
                r.execution_stage,
                COALESCE(d.callback_deadline_at <= clock_timestamp(), false) AS callback_expired,
                clock_timestamp() AS settled_at
           FROM ${table(this.schema, "delegations")} d
           JOIN ${table(this.schema, "runs")} r ON r.id = d.run_id
          WHERE d.id = $1
            AND d.run_id = $2
          FOR UPDATE OF d, r`,
        [input.delegationId, locatedRunId],
      );
      const row = selected.rows[0];
      if (!row) {
        return { accepted: false };
      }
      if (["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(row.delegation_status)) {
        return { accepted: false, runId: row.run_id };
      }
      // 启用超时时由数据库时钟裁决；即使扫描器尚未抢到，迟到 Resume 也不能越过期限。
      if (input.enforceDeadline !== false && row.callback_expired) {
        return { accepted: false, runId: row.run_id };
      }
      if (["CANCELLING", "COMPLETED", "FAILED", "CANCELLED"].includes(row.run_status)) {
        return { accepted: false, runId: row.run_id };
      }
      const settledAt = milliseconds(row.settled_at);
      const resultStatus =
        input.status === "CANCELLED"
          ? "cancelled"
          : input.status === "FAILED"
            ? "failed"
            : "completed";
      const error =
        input.status === "COMPLETED"
          ? undefined
          : input.finalAnswer || `Child agent returned ${input.status}`;
      const result = {
        status: resultStatus,
        output: input.finalAnswer,
        artifacts: [],
        ...(error ? { error } : {}),
      };
      await client.query(
        `UPDATE ${table(this.schema, "delegations")}
            SET status = $2, result = $3::jsonb, error = $4,
                version = version + 1, updated_at = $5, finished_at = $5
          WHERE id = $1`,
        [input.delegationId, input.status, JSON.stringify(result), error ?? null, date(settledAt)],
      );
      await appendRunEvent(client, this.schema, {
        timestamp: settledAt,
        runId: row.run_id,
        type: input.status === "COMPLETED" ? "delegation.completed" : "delegation.failed",
        data: {
          delegationId: row.delegation_id,
          agentId: row.agent_id,
          ...(row.agent_name ? { agentName: row.agent_name } : {}),
          status: input.status,
          artifactCount: 0,
          resultStatus,
          hasOutput: Boolean(input.finalAnswer),
          ...(input.status === "COMPLETED" ? {} : { failureStage: "agent_callback" }),
          ...(error ? { error } : {}),
        },
      });
      const wakeRun =
        (row.run_status === "WAITING_AGENT" && row.execution_stage === "CONNECTOR_WAITING") ||
        row.run_status === "RUNNING";
      if (wakeRun) {
        await client.query(
          `UPDATE ${table(this.schema, "runs")}
              SET status = 'QUEUED', execution_stage = 'CONNECTOR_WAITING',
                  version = version + 1, updated_at = $2
            WHERE id = $1`,
          [row.run_id, date(settledAt)],
        );
        await appendRunEvent(client, this.schema, {
          timestamp: settledAt,
          runId: row.run_id,
          type: "run.status",
          data: {
            status: "QUEUED",
            delegationId: input.delegationId,
            resumed: true,
          },
        });
        await client.query("SELECT pg_notify($1, $2)", [
          `byclaw_runs_${this.schema}`,
          "callback-resume",
        ]);
      }
      await notifyRunEvent(client, this.schema, row.run_id);
      return { accepted: true, runId: row.run_id, wakeRun };
    });
  }

  async claimCallbackTimeoutDeliveries(input: {
    instanceId: string;
    leaseMs: number;
    limit: number;
  }): Promise<CallbackTimeoutDelivery[]> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<{
        run_id: string;
        external_session_id: string | null;
        trace_id: string | null;
        parent_message_id: string | null;
        run_status: "COMPLETED" | "FAILED" | "CANCELLED";
        final_answer: string | null;
        error_message: string | null;
      }>(
        `SELECT o.run_id,
                r.ingress_context->>'externalSessionId' AS external_session_id,
                r.ingress_context->>'traceId' AS trace_id,
                r.ingress_context->>'parentMessageId' AS parent_message_id,
                r.status AS run_status, r.final_answer, r.error_message
           FROM ${table(this.schema, "callback_timeout_outbox")} o
           JOIN ${table(this.schema, "runs")} r ON r.id = o.run_id
          WHERE o.delivered_at IS NULL
            AND (o.claim_expires_at IS NULL OR o.claim_expires_at <= clock_timestamp())
            AND r.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
          ORDER BY o.created_at, o.run_id
          FOR UPDATE OF o SKIP LOCKED
          LIMIT $1`,
        [input.limit],
      );
      const deliveries: CallbackTimeoutDelivery[] = [];
      for (const row of selected.rows) {
        await client.query(
          `UPDATE ${table(this.schema, "callback_timeout_outbox")}
              SET claimed_by = $2,
                  claim_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
                  attempt_count = attempt_count + 1,
                  updated_at = clock_timestamp()
            WHERE run_id = $1`,
          [row.run_id, input.instanceId, input.leaseMs],
        );
        const hasAnyExternalRoute = Boolean(
          row.external_session_id || row.trace_id || row.parent_message_id,
        );
        if (!hasAnyExternalRoute) {
          // HTTP/SSE Run 没有 by-framework 外部流，数据库 run.failed 已经是它的终态。
          await client.query(
            `UPDATE ${table(this.schema, "callback_timeout_outbox")}
                SET delivered_at = clock_timestamp(), updated_at = clock_timestamp()
              WHERE run_id = $1 AND claimed_by = $2`,
            [row.run_id, input.instanceId],
          );
          continue;
        }
        const deliveryResult = {
          runId: row.run_id,
          runStatus: row.run_status,
          ...(row.final_answer === null ? {} : { finalAnswer: row.final_answer }),
          ...(row.error_message === null ? {} : { error: row.error_message }),
        };
        if (!row.external_session_id || !row.trace_id) {
          const missingFields = [
            !row.external_session_id ? "externalSessionId" : "",
            !row.trace_id ? "traceId" : "",
          ].filter(Boolean);
          deliveries.push({
            ...deliveryResult,
            routingError: `Callback timeout routing is incomplete: missing ${missingFields.join(", ")}`,
            ...(row.external_session_id
              ? { externalSessionId: row.external_session_id }
              : {}),
            ...(row.trace_id ? { traceId: row.trace_id } : {}),
            ...(row.parent_message_id
              ? { parentMessageId: row.parent_message_id }
              : {}),
          });
          continue;
        }
        deliveries.push({
          ...deliveryResult,
          externalSessionId: row.external_session_id,
          traceId: row.trace_id,
          // session + trace 已足以关闭正确的前端流；旧数据缺少 messageId 时使用稳定节点。
          parentMessageId:
            row.parent_message_id ?? `${row.run_id}:super-summary:answer`,
        });
      }
      return deliveries;
    });
  }

  async completeCallbackTimeoutDelivery(input: {
    runId: string;
    instanceId: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${table(this.schema, "callback_timeout_outbox")}
          SET delivered_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE run_id = $1
          AND claimed_by = $2
          AND delivered_at IS NULL`,
      [input.runId, input.instanceId],
    );
    return result.rowCount === 1;
  }
}

export class PostgresExecutionCredentialRepository
implements ExecutionCredentialRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async save(credential: ExecutionCredential): Promise<void> {
    await transaction(this.pool, async (client) => {
      await writeCredential(client, this.schema, credential);
    });
  }

  async loadForLease(input: {
    runId: string;
    instanceId: string;
    fencingToken: number;
  }): Promise<ExecutionCredential | undefined> {
    const result = await this.pool.query(
      `SELECT c.*
         FROM ${table(this.schema, "run_execution_credentials")} c
         JOIN ${table(this.schema, "runs")} r ON r.id = c.run_id
         JOIN ${table(this.schema, "session_execution_leases")} l
           ON l.session_id = r.session_id AND l.run_id = r.id
        WHERE c.run_id = $1
          AND l.owner_instance_id = $2
          AND l.fencing_token = $3
          AND l.lease_expires_at > clock_timestamp()`,
      [input.runId, input.instanceId, input.fencingToken],
    );
    return result.rows[0] ? mapCredential(result.rows[0]) : undefined;
  }

  async delete(runId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${table(this.schema, "run_execution_credentials")} WHERE run_id = $1`,
      [runId],
    );
  }
}

async function writeCredential(
  client: PoolClient,
  schema: string,
  credential: ExecutionCredential,
): Promise<void> {
  const values = [credential.runId, credential.secret, date(credential.createdAt)];
  await advisoryLock(client, `credential:${credential.runId}`);
  const updated = await client.query(
    `UPDATE ${table(schema, "run_execution_credentials")}
        SET credential = $2,
            expires_at = 'infinity'::timestamptz,
            created_at = $3
      WHERE run_id = $1`,
    values,
  );
  if (updated.rowCount === 0) {
    await client.query(
      `INSERT INTO ${table(schema, "run_execution_credentials")} (
         run_id, credential, expires_at, created_at
       ) VALUES ($1, $2, 'infinity'::timestamptz, $3)`,
      values,
    );
  }
}

/**
 * Pi JSONL 的数据库真源。COMMITTED 前缀不可修改，PENDING 尾部按 run/attempt 隔离；
 * commit 使用 Session revision CAS，防止两个实例覆盖同一上下文。
 */
export class PostgresLeaderCheckpointStore implements LeaderCheckpointStore {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
    private readonly limits: {
      entryMaxBytes: number;
      sessionMaxBytes: number;
      sessionMaxEntries: number;
    } = {
      entryMaxBytes: 1_048_576,
      sessionMaxBytes: 16_777_216,
      sessionMaxEntries: 20_000,
    },
  ) {}

  async load(
    sessionId: string,
  ): Promise<{ revision: number; checkpoint: PiSessionCheckpoint } | undefined> {
    return this.#load(sessionId, undefined);
  }

  async loadWorking(input: {
    sessionId: string;
    runId: string;
    attemptNo: number;
  }): Promise<{ revision: number; checkpoint: PiSessionCheckpoint } | undefined> {
    return this.#load(input.sessionId, {
      runId: input.runId,
      attemptNo: input.attemptNo,
    });
  }

  async #load(
    sessionId: string,
    pending:
      | {
          runId: string;
          attemptNo: number;
        }
      | undefined,
  ): Promise<{ revision: number; checkpoint: PiSessionCheckpoint } | undefined> {
    const session = await this.pool.query(
      `SELECT * FROM ${table(this.schema, "pi_sessions")} WHERE session_id = $1`,
      [sessionId],
    );
    const row = session.rows[0];
    if (!row) {
      return undefined;
    }
    const entries = await this.pool.query<{ entry_json: unknown }>(
      `SELECT entry_json
         FROM ${table(this.schema, "pi_session_entries")}
        WHERE session_id = $1
          AND (
            visibility = 'COMMITTED'
            ${pending ? "OR (visibility = 'PENDING' AND run_id = $2 AND attempt_no = $3)" : ""}
          )
        ORDER BY seq`,
      pending
        ? [sessionId, pending.runId, pending.attemptNo]
        : [sessionId],
    );
    const entryValues = entries.rows.map(
      (entry) => entry.entry_json as PiSessionCheckpoint["entries"][number],
    );
    const activeLeafId = entryValues.at(-1)?.id ?? null;
    const checkpoint = createPiSessionCheckpoint({
      piSdkVersion: text(row.pi_sdk_version),
      header: row.header as PiSessionCheckpoint["header"],
      entries: entryValues,
      activeLeafId,
    });
    if (!pending && checkpoint.checksum !== text(row.checksum)) {
      throw new Error(`Pi checkpoint checksum mismatch in PostgreSQL: ${sessionId}`);
    }
    return { revision: integer(row.revision), checkpoint };
  }

  async stagePending(input: {
    sessionId: string;
    runId: string;
    attemptNo: number;
    baseRevision: number;
    checkpoint: PiSessionCheckpoint;
    now: number;
    claim?: RunExecutionClaim;
  }): Promise<void> {
    validatePiSessionCheckpoint(input.checkpoint);
    validateCheckpointLimits(input.checkpoint, this.limits);
    await transaction(this.pool, async (client) => {
      if (input.claim) {
        await assertExecutableLease(client, this.schema, input.claim);
      }
      const session = await lockSessionRevision(client, this.schema, input.sessionId);
      if (session !== input.baseRevision) {
        throw new Error(
          `Pi context revision conflict: expected ${input.baseRevision}, received ${session}`,
        );
      }
      const committed = await committedEntries(client, this.schema, input.sessionId);
      assertCheckpointPrefix(committed, input.checkpoint);
      // 首轮尚无 committed transcript，也要先保存空 header，
      // 否则实例在第一次 Run 中途宕机时无法组合 PENDING entries 恢复。
      const emptyCheckpoint = createPiSessionCheckpoint({
        piSdkVersion: input.checkpoint.piSdkVersion,
        header: input.checkpoint.header,
        entries: [],
        activeLeafId: null,
      });
      const emptyValues = [
          input.sessionId,
          emptyCheckpoint.header.id,
          emptyCheckpoint.piSdkVersion,
          emptyCheckpoint.sessionFormatVersion,
          JSON.stringify(emptyCheckpoint.header),
          input.baseRevision,
          Buffer.byteLength(JSON.stringify([emptyCheckpoint.header]), "utf8"),
          emptyCheckpoint.checksum,
          date(input.now),
      ];
      const existingPiSession = await client.query(
        `SELECT 1 FROM ${table(this.schema, "pi_sessions")} WHERE session_id = $1`,
        [input.sessionId],
      );
      if (existingPiSession.rowCount === 0) {
        await client.query(
          `INSERT INTO ${table(this.schema, "pi_sessions")} (
             session_id, pi_session_id, pi_sdk_version, session_format_version,
             header, active_leaf_id, revision, entry_count, content_bytes,
             checksum, updated_at
           ) VALUES ($1, $2, $3, $4, $5::jsonb, NULL, $6, 0, $7, $8, $9)`,
          emptyValues,
        );
      }
      await client.query(
        `DELETE FROM ${table(this.schema, "pi_session_entries")}
          WHERE run_id = $1 AND visibility = 'PENDING'`,
        [input.runId],
      );
      const pending = input.checkpoint.entries.slice(committed.length);
      await insertPiEntries(client, this.schema, {
        sessionId: input.sessionId,
        entries: pending,
        startSeq: committed.length + 1,
        visibility: "PENDING",
        runId: input.runId,
        attemptNo: input.attemptNo,
        now: input.now,
      });
    });
  }

  async commit(input: {
    sessionId: string;
    runId: string;
    attemptNo: number;
    expectedRevision: number;
    checkpoint: PiSessionCheckpoint;
    now: number;
    claim?: RunExecutionClaim;
    completion?: {
      run: Run;
      event: Omit<RunEvent, "eventId">;
    };
  }): Promise<{ revision: number; event?: RunEvent }> {
    validatePiSessionCheckpoint(input.checkpoint);
    validateCheckpointLimits(input.checkpoint, this.limits);
    return transaction(this.pool, async (client) => {
      if (input.claim) {
        await assertLease(client, this.schema, input.claim);
      }
      const revision = await lockSessionRevision(client, this.schema, input.sessionId);
      if (revision !== input.expectedRevision) {
        throw new Error(
          `Pi context revision conflict: expected ${input.expectedRevision}, received ${revision}`,
        );
      }
      const committed = await committedEntries(client, this.schema, input.sessionId);
      assertCheckpointPrefix(committed, input.checkpoint);
      await client.query(
        `DELETE FROM ${table(this.schema, "pi_session_entries")}
          WHERE run_id = $1 AND visibility = 'PENDING'`,
        [input.runId],
      );
      const appended = input.checkpoint.entries.slice(committed.length);
      await insertPiEntries(client, this.schema, {
        sessionId: input.sessionId,
        entries: appended,
        startSeq: committed.length + 1,
        visibility: "COMMITTED",
        runId: input.runId,
        attemptNo: input.attemptNo,
        now: input.now,
      });
      const nextRevision = revision + 1;
      const contentBytes = Buffer.byteLength(
        JSON.stringify([input.checkpoint.header, ...input.checkpoint.entries]),
        "utf8",
      );
      const piValues = [
          input.sessionId,
          input.checkpoint.header.id,
          input.checkpoint.piSdkVersion,
          input.checkpoint.sessionFormatVersion,
          JSON.stringify(input.checkpoint.header),
          input.checkpoint.activeLeafId,
          nextRevision,
          input.checkpoint.entries.length,
          contentBytes,
          input.checkpoint.checksum,
          date(input.now),
      ];
      const updatedPi = await client.query(
        `UPDATE ${table(this.schema, "pi_sessions")}
            SET pi_sdk_version = $2,
                session_format_version = $3,
                header = $4::jsonb,
                active_leaf_id = $5,
                revision = $6,
                entry_count = $7,
                content_bytes = $8,
                checksum = $9,
                updated_at = $10
          WHERE session_id = $1`,
        [
          input.sessionId,
          input.checkpoint.piSdkVersion,
          input.checkpoint.sessionFormatVersion,
          JSON.stringify(input.checkpoint.header),
          input.checkpoint.activeLeafId,
          nextRevision,
          input.checkpoint.entries.length,
          contentBytes,
          input.checkpoint.checksum,
          date(input.now),
        ],
      );
      if (updatedPi.rowCount === 0) {
        await client.query(
          `INSERT INTO ${table(this.schema, "pi_sessions")} (
             session_id, pi_session_id, pi_sdk_version, session_format_version,
             header, active_leaf_id, revision, entry_count, content_bytes,
             checksum, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11
           )`,
          piValues,
        );
      }
      await client.query(
        `UPDATE ${table(this.schema, "sessions")}
            SET context_revision = $2, updated_at = $3
          WHERE id = $1`,
        [input.sessionId, nextRevision, date(input.now)],
      );
      let completionEvent: RunEvent | undefined;
      if (input.completion) {
        const run = input.completion.run;
        const updated = await client.query(
          `UPDATE ${table(this.schema, "runs")}
              SET status = $2,
                  execution_stage = $3,
                  final_answer = $4,
                  error_message = $5,
                  version = $6,
                  updated_at = $7,
                  finished_at = $8
            WHERE id = $1
              AND session_id = $9
              AND ($10::bigint IS NULL OR lease_fencing_token = $10)
              AND version = $11`,
          [
            run.id,
            run.status,
            run.executionStage,
            run.finalAnswer ?? null,
            run.error ?? null,
            run.version,
            date(run.updatedAt),
            nullableDate(run.finishedAt),
            run.sessionId,
            run.leaseFencingToken ?? null,
            run.version - 1,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new Error(`Run completion rejected by fencing token: ${run.id}`);
        }
        completionEvent = await appendRunEvent(
          client,
          this.schema,
          input.completion.event,
        );
        await notifyRunEvent(client, this.schema, run.id);
        await client.query(
          `DELETE FROM ${table(this.schema, "run_execution_credentials")}
            WHERE run_id = $1`,
          [run.id],
        );
      }
      return {
        revision: nextRevision,
        ...(completionEvent ? { event: completionEvent } : {}),
      };
    });
  }

  async discardPending(
    runId: string,
    attemptNo: number,
    claim?: RunExecutionClaim,
  ): Promise<void> {
    await transaction(this.pool, async (client) => {
      if (claim) {
        await assertLease(client, this.schema, claim);
      }
      await client.query(
        `DELETE FROM ${table(this.schema, "pi_session_entries")}
          WHERE run_id = $1 AND attempt_no = $2 AND visibility = 'PENDING'`,
        [runId, attemptNo],
      );
    });
  }
}

async function writeDelegation(
  client: PoolClient,
  schema: string,
  delegation: Delegation,
): Promise<void> {
  await advisoryLock(client, `delegation:${delegation.id}`);
  const values = [
    delegation.id,
    delegation.runId,
    delegation.agentId,
    delegation.connectorId,
    delegation.task,
    delegation.expectedOutput ?? null,
    delegation.status,
    json(delegation.externalRef),
    delegation.connectorCursor ?? null,
    json(delegation.result),
    delegation.partialOutput ?? null,
    delegation.error ?? null,
    delegation.version,
    date(delegation.createdAt),
    date(delegation.updatedAt),
    nullableDate(delegation.startedAt),
    nullableDate(delegation.finishedAt),
    delegation.agentName ?? null,
    nullableDate(delegation.lastActivityAt),
    nullableDate(delegation.callbackDeadlineAt),
  ];
  const updated = await client.query(
    `UPDATE ${table(schema, "delegations")}
        SET status = $2,
            external_ref = $3::jsonb,
            connector_cursor = $4,
            result = $5::jsonb,
            partial_output = $6,
            error = $7,
            version = $8::bigint,
            updated_at = $9,
            started_at = $10,
            finished_at = $11,
            agent_name = $12,
            last_activity_at = $13,
            callback_deadline_at = CASE
              WHEN $14::timestamptz IS NULL THEN NULL
              WHEN callback_deadline_at IS NULL
                THEN clock_timestamp() + ($14::timestamptz - $9::timestamptz)
              ELSE callback_deadline_at
            END
      WHERE id = $1 AND version = $8::bigint - 1`,
    [
      delegation.id,
      delegation.status,
      json(delegation.externalRef),
      delegation.connectorCursor ?? null,
      json(delegation.result),
      delegation.partialOutput ?? null,
      delegation.error ?? null,
      delegation.version,
      date(delegation.updatedAt),
      nullableDate(delegation.startedAt),
      nullableDate(delegation.finishedAt),
      delegation.agentName ?? null,
      nullableDate(delegation.lastActivityAt),
      nullableDate(delegation.callbackDeadlineAt),
    ],
  );
  if (updated.rowCount !== 0) {
    return;
  }
  const exists = await client.query(
    `SELECT 1 FROM ${table(schema, "delegations")} WHERE id = $1`,
    [delegation.id],
  );
  if (exists.rowCount) {
    throw new Error(`Delegation optimistic lock rejected: ${delegation.id}`);
  }
  await client.query(
    `INSERT INTO ${table(schema, "delegations")} (
       id, run_id, agent_id, connector_id, task, expected_output, status,
       external_ref, connector_cursor, result, partial_output, error, version,
       created_at, updated_at, started_at, finished_at, agent_name, last_activity_at,
       callback_deadline_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12, $13,
       $14, $15, $16, $17, $18, $19,
       CASE
         WHEN $20::timestamptz IS NULL THEN NULL
         ELSE clock_timestamp() + ($20::timestamptz - $15::timestamptz)
       END
     )`,
    values,
  );
}

async function appendRunEvent(
  client: PoolClient,
  schema: string,
  event: Omit<RunEvent, "eventId">,
): Promise<RunEvent> {
  await lockRunEventSequence(client, event.runId);
  const result = await client.query(
    `INSERT INTO ${table(schema, "run_events")}
       (run_id, event_id, timestamp, type, data)
     SELECT $1, COALESCE(max(event_id), 0) + 1, $2, $3, $4::jsonb
       FROM ${table(schema, "run_events")}
      WHERE run_id = $1
     RETURNING *`,
    [
      event.runId,
      date(event.timestamp),
      event.type,
      JSON.stringify(event.data),
    ],
  );
  return mapRunEvent(requiredRow(result.rows[0], "inserted RunEvent"));
}

/** NOTIFY 只负责降低 SSE 延迟；消费者始终会再次查询数据库，因此通知丢失不丢事件。 */
async function notifyRunEvent(
  client: PoolClient,
  schema: string,
  runId: string,
): Promise<void> {
  await client.query("SELECT pg_notify($1, $2)", [
    `byclaw_events_${schema}`,
    runId,
  ]);
}

async function lockSessionRevision(
  client: PoolClient,
  schema: string,
  sessionId: string,
): Promise<number> {
  const result = await client.query<{ context_revision: number | string }>(
    `SELECT context_revision
       FROM ${table(schema, "sessions")}
      WHERE id = $1
      FOR UPDATE`,
    [sessionId],
  );
  if (!result.rows[0]) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return integer(result.rows[0].context_revision);
}

async function committedEntries(
  client: PoolClient,
  schema: string,
  sessionId: string,
): Promise<Array<PiSessionCheckpoint["entries"][number]>> {
  const result = await client.query<{ entry_json: unknown }>(
    `SELECT entry_json
       FROM ${table(schema, "pi_session_entries")}
      WHERE session_id = $1 AND visibility = 'COMMITTED'
      ORDER BY seq`,
    [sessionId],
  );
  return result.rows.map(
    (row) => row.entry_json as PiSessionCheckpoint["entries"][number],
  );
}

function assertCheckpointPrefix(
  committed: Array<PiSessionCheckpoint["entries"][number]>,
  checkpoint: PiSessionCheckpoint,
): void {
  if (checkpoint.entries.length < committed.length) {
    throw new Error("Pi checkpoint cannot truncate committed entries");
  }
  for (let index = 0; index < committed.length; index += 1) {
    if (committed[index]?.id !== checkpoint.entries[index]?.id) {
      throw new Error(`Pi checkpoint changed committed entry at seq ${index + 1}`);
    }
  }
}

async function insertPiEntries(
  client: PoolClient,
  schema: string,
  input: {
    sessionId: string;
    entries: Array<PiSessionCheckpoint["entries"][number]>;
    startSeq: number;
    visibility: "COMMITTED" | "PENDING";
    runId: string;
    attemptNo: number;
    now: number;
  },
): Promise<void> {
  for (const [offset, entry] of input.entries.entries()) {
    await client.query(
      `INSERT INTO ${table(schema, "pi_session_entries")} (
         session_id, seq, entry_id, parent_id, entry_type, entry_json,
         visibility, run_id, attempt_no, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [
        input.sessionId,
        input.startSeq + offset,
        entry.id,
        entry.parentId,
        entry.type,
        JSON.stringify(entry),
        input.visibility,
        input.runId,
        input.attemptNo,
        date(input.now),
      ],
    );
  }
}

function validateCheckpointLimits(
  checkpoint: PiSessionCheckpoint,
  limits: {
    entryMaxBytes: number;
    sessionMaxBytes: number;
    sessionMaxEntries: number;
  },
): void {
  if (checkpoint.entries.length > limits.sessionMaxEntries) {
    throw new Error(
      `Pi session entry limit exceeded: ${checkpoint.entries.length}/${limits.sessionMaxEntries}`,
    );
  }
  const sessionBytes = Buffer.byteLength(
    JSON.stringify([checkpoint.header, ...checkpoint.entries]),
    "utf8",
  );
  if (sessionBytes > limits.sessionMaxBytes) {
    throw new Error(
      `Pi session byte limit exceeded: ${sessionBytes}/${limits.sessionMaxBytes}`,
    );
  }
  for (const entry of checkpoint.entries) {
    const entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    if (entryBytes > limits.entryMaxBytes) {
      throw new Error(
        `Pi entry byte limit exceeded: ${entry.id} ${entryBytes}/${limits.entryMaxBytes}`,
      );
    }
    validatePiEntryContent(entry);
  }
}

/** 仅允许运行时显式暴露的 Leader 工具进入数据库 checkpoint，未知工具继续 fail closed。 */
function validatePiEntryContent(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      validatePiEntryContent(item);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type === "toolCall" &&
    !ALLOWED_PI_TOOL_NAMES.has(String(record.name))
  ) {
    throw new Error(`Unsupported Pi tool call: ${String(record.name)}`);
  }
  if (
    record.role === "toolResult" &&
    !ALLOWED_PI_TOOL_NAMES.has(String(record.toolName))
  ) {
    throw new Error(`Unsupported Pi tool result: ${String(record.toolName)}`);
  }
  for (const nested of Object.values(record)) {
    validatePiEntryContent(nested);
  }
}

function mapSession(row: QueryResultRow): Session {
  return {
    id: text(row.id),
    owner: {
      userCode: text(row.user_code),
      ...(row.user_name ? { userName: text(row.user_name) } : {}),
    },
    sessionContext: parseSessionContext(row.session_context),
    sessionContextVersion: integer(row.session_context_version),
    contextRevision: integer(row.context_revision),
    createdAt: milliseconds(row.created_at),
    updatedAt: milliseconds(row.updated_at),
  };
}

function runValues(run: Run): unknown[] {
  return [
    run.id,
    run.sessionId,
    run.input,
    run.thinkingLevel ?? "off",
    JSON.stringify(run.agentList),
    JSON.stringify(run.attachments ?? []),
    run.ingressContext ? JSON.stringify(run.ingressContext) : null,
    run.status,
    run.baseContextRevision,
    run.attemptNo,
    run.executionStage,
    run.leaseFencingToken ?? null,
    run.finalAnswer ?? null,
    run.error ?? null,
    run.version,
    date(run.createdAt),
    date(run.updatedAt),
    nullableDate(run.startedAt),
    nullableDate(run.finishedAt),
  ];
}

async function writeRun(
  client: PoolClient,
  schema: string,
  run: Run,
): Promise<void> {
  const values = runValues(run);
  await advisoryLock(client, `run:${run.id}`);
  const updated = await client.query(
    `UPDATE ${table(schema, "runs")}
        SET status = $2,
            attempt_no = $3,
            execution_stage = $4,
            lease_fencing_token = $5,
            final_answer = $6,
            error_message = $7,
            version = $8::bigint,
            updated_at = $9,
            started_at = $10,
            finished_at = $11
      WHERE id = $1
        AND version = $8::bigint - 1
        AND ($5::bigint IS NULL OR lease_fencing_token = $5)`,
    [
      run.id,
      run.status,
      run.attemptNo,
      run.executionStage,
      run.leaseFencingToken ?? null,
      run.finalAnswer ?? null,
      run.error ?? null,
      run.version,
      date(run.updatedAt),
      nullableDate(run.startedAt),
      nullableDate(run.finishedAt),
    ],
  );
  if (updated.rowCount === 1) {
    return;
  }
  const existing = await client.query(
    `SELECT 1 FROM ${table(schema, "runs")} WHERE id = $1`,
    [run.id],
  );
  if (existing.rowCount) {
    throw new Error(`Run optimistic lock or fencing token rejected: ${run.id}`);
  }
  await client.query(
    `INSERT INTO ${table(schema, "runs")} (
       id, session_id, input, thinking_level, agent_snapshot, attachments, ingress_context,
       status, base_context_revision,
       attempt_no, execution_stage, lease_fencing_token, final_answer,
       error_message, version, created_at, updated_at, started_at, finished_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11,
       $12, $13, $14, $15, $16, $17, $18, $19
     )`,
    values,
  );
}

function mapRun(row: QueryResultRow): Run {
  const thinkingLevel = row.thinking_level ?? "off";
  if (!isThinkingLevel(thinkingLevel)) {
    throw new Error(`Invalid persisted Run thinking level: ${String(thinkingLevel)}`);
  }
  const ingressContext = readIngressContext(row.ingress_context);
  return {
    id: text(row.id),
    sessionId: text(row.session_id),
    input: text(row.input),
    attachments: readAttachments(row.attachments),
    ...(ingressContext ? { ingressContext } : {}),
    thinkingLevel,
    agentList: row.agent_snapshot as Run["agentList"],
    status: row.status as Run["status"],
    baseContextRevision: integer(row.base_context_revision),
    attemptNo: integer(row.attempt_no),
    executionStage: row.execution_stage as Run["executionStage"],
    ...(row.lease_fencing_token === null
      ? {}
      : { leaseFencingToken: integer(row.lease_fencing_token) }),
    version: integer(row.version),
    ...(row.final_answer === null ? {} : { finalAnswer: text(row.final_answer) }),
    ...(row.error_message === null ? {} : { error: text(row.error_message) }),
    createdAt: milliseconds(row.created_at),
    updatedAt: milliseconds(row.updated_at),
    ...(row.started_at === null ? {} : { startedAt: milliseconds(row.started_at) }),
    ...(row.finished_at === null ? {} : { finishedAt: milliseconds(row.finished_at) }),
  };
}

function mapDelegation(row: QueryResultRow): Delegation {
  return {
    id: text(row.id),
    runId: text(row.run_id),
    agentId: text(row.agent_id),
    ...(row.agent_name === null ? {} : { agentName: text(row.agent_name) }),
    connectorId: text(row.connector_id),
    task: text(row.task),
    ...(row.expected_output === null
      ? {}
      : { expectedOutput: text(row.expected_output) }),
    status: row.status as Delegation["status"],
    ...(row.external_ref === null
      ? {}
      : { externalRef: row.external_ref as NonNullable<Delegation["externalRef"]> }),
    ...(row.connector_cursor === null
      ? {}
      : { connectorCursor: text(row.connector_cursor) }),
    ...(row.result === null
      ? {}
      : { result: row.result as NonNullable<Delegation["result"]> }),
    ...(row.partial_output === null
      ? {}
      : { partialOutput: text(row.partial_output) }),
    ...(row.error === null ? {} : { error: text(row.error) }),
    version: integer(row.version),
    createdAt: milliseconds(row.created_at),
    updatedAt: milliseconds(row.updated_at),
    ...(row.started_at === null ? {} : { startedAt: milliseconds(row.started_at) }),
    ...(row.finished_at === null ? {} : { finishedAt: milliseconds(row.finished_at) }),
    ...(row.last_activity_at === null
      ? {}
      : { lastActivityAt: milliseconds(row.last_activity_at) }),
    ...(row.callback_deadline_at === null
      ? {}
      : { callbackDeadlineAt: milliseconds(row.callback_deadline_at) }),
  };
}

function mapRunEvent(row: QueryResultRow): RunEvent {
  return {
    eventId: integer(row.event_id),
    timestamp: milliseconds(row.timestamp),
    runId: text(row.run_id),
    type: row.type as RunEvent["type"],
    data: row.data as Record<string, JsonValue>,
  };
}

/**
 * 读取并校验持久化的附件：必须是数组，且每个元素至少有字符串 id/name，否则整体降级为 []。
 * 数据库异常 JSON 不得直接进入 Connector。
 */
function readAttachments(raw: unknown): RunAttachment[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (entry): entry is RunAttachment =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).id === "string" &&
      typeof (entry as Record<string, unknown>).name === "string",
  );
}

/** 持久化的入口上下文仍按公开契约重新校验，避免损坏 JSON 进入模型上下文。 */
function readIngressContext(raw: unknown): RunIngressContextV1 | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid persisted Run ingress context");
  }
  const record = raw as Record<string, unknown>;
  const externalSessionId =
    typeof record.externalSessionId === "string" && record.externalSessionId.trim()
      ? record.externalSessionId.trim()
      : undefined;
  if (record.externalSessionId !== undefined && !externalSessionId) {
    throw new Error("Invalid persisted Run external session ID");
  }
  const parentMessageId =
    typeof record.parentMessageId === "string" && record.parentMessageId.trim()
      ? record.parentMessageId.trim()
      : undefined;
  if (record.parentMessageId !== undefined && !parentMessageId) {
    throw new Error("Invalid persisted Run parent message ID");
  }
  const traceId =
    typeof record.traceId === "string" && record.traceId.trim()
      ? record.traceId.trim()
      : undefined;
  if (record.traceId !== undefined && !traceId) {
    throw new Error("Invalid persisted Run trace ID");
  }
  const agentCatalogError =
    typeof record.agentCatalogError === "string" && record.agentCatalogError.trim()
      ? record.agentCatalogError.trim()
      : undefined;
  if (record.agentCatalogError !== undefined && !agentCatalogError) {
    throw new Error("Invalid persisted Run agent catalog error");
  }
  const leaderModel = readLeaderModelSelection(record.leaderModel);
  const orchestrator =
    record.orchestrator === undefined
      ? undefined
      : parseExpertTeamRuntimeSnapshot(record.orchestrator);
  if (record.groupChat === undefined) {
    return externalSessionId ||
      parentMessageId ||
      traceId ||
      agentCatalogError ||
      leaderModel ||
      orchestrator
      ? {
          ...(externalSessionId ? { externalSessionId } : {}),
          ...(parentMessageId ? { parentMessageId } : {}),
          ...(traceId ? { traceId } : {}),
          ...(agentCatalogError ? { agentCatalogError } : {}),
          ...(leaderModel ? { leaderModel } : {}),
          ...(orchestrator ? { orchestrator } : {}),
        }
      : undefined;
  }
  const groupChat = parseGroupChatContext(record.groupChat);
  const fingerprint = fingerprintGroupChatContext(groupChat);
  if (
    record.groupChatFingerprint !== undefined &&
    record.groupChatFingerprint !== fingerprint
  ) {
    throw new Error("Persisted Run group chat context fingerprint mismatch");
  }
  return {
    ...(externalSessionId ? { externalSessionId } : {}),
    ...(parentMessageId ? { parentMessageId } : {}),
    ...(traceId ? { traceId } : {}),
    groupChat,
    groupChatFingerprint: fingerprint,
    ...(agentCatalogError ? { agentCatalogError } : {}),
    ...(leaderModel ? { leaderModel } : {}),
    ...(orchestrator ? { orchestrator } : {}),
  };
}

function readLeaderModelSelection(raw: unknown) {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid persisted Run Leader model selection");
  }
  const record = raw as Record<string, unknown>;
  const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
  const fingerprint =
    typeof record.fingerprint === "string" ? record.fingerprint.trim() : "";
  if (!modelId || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("Invalid persisted Run Leader model selection");
  }
  return { modelId, fingerprint };
}

function mapCredential(row: QueryResultRow): ExecutionCredential {
  return {
    runId: text(row.run_id),
    secret: text(row.credential),
    createdAt: milliseconds(row.created_at),
  };
}

async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (!isRetryableTransactionError(error) || attempt === maxAttempts) {
        throw error;
      }
    } finally {
      client.release();
    }
    await transactionRetryDelay(attempt);
  }
  throw new Error("PostgreSQL transaction retry loop exhausted");
}

/** Run 事件 ID 分配与其外键检查共用的事务级锁，所有复合事务必须先拿此锁。 */
async function lockRunEventSequence(client: PoolClient, runId: string): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
    [`byclaw-run-event:${runId}`],
  );
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "40P01" || code === "40001";
}

function transactionRetryDelay(attempt: number): Promise<void> {
  const delayMs = 5 * 2 ** (attempt - 1) + Math.floor(Math.random() * 10);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** 兼容 PostgreSQL 与不支持 ON CONFLICT 的 openGauss，用事务级锁串行化 upsert。 */
async function advisoryLock(client: PoolClient, key: string): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
    [`byclaw-storage:${key}`],
  );
}

async function assertLease(
  client: PoolClient,
  schema: string,
  claim: RunExecutionClaim,
): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM ${table(schema, "session_execution_leases")} l
      WHERE l.session_id = $1
        AND l.run_id = $2
        AND l.owner_instance_id = $3
        AND l.fencing_token = $4
        AND l.lease_expires_at > clock_timestamp()`,
    [
      claim.sessionId,
      claim.runId,
      claim.ownerInstanceId,
      claim.fencingToken,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(`Run lease fencing token lost: ${claim.runId}`);
  }
}

async function assertExecutableLease(
  client: PoolClient,
  schema: string,
  claim: RunExecutionClaim,
): Promise<void> {
  await assertLease(client, schema, claim);
  const result = await client.query(
    `SELECT 1 FROM ${table(schema, "runs")}
      WHERE id = $1
        AND status NOT IN ('CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    [claim.runId],
  );
  if (result.rowCount !== 1) {
    throw new Error(`Run is no longer executable: ${claim.runId}`);
  }
}

function safeIdentifier(value: string, name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`${name} must be a PostgreSQL identifier, received: ${value}`);
  }
  return value;
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function table(schema: string, name: string): string {
  return `${quote(schema)}.${quote(`${POSTGRES_TABLE_PREFIX}${name}`)}`;
}

function date(value: number): Date {
  return new Date(value);
}

function nullableDate(value: number | undefined): Date | null {
  return value === undefined ? null : date(value);
}

function milliseconds(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = new Date(text(value)).getTime();
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid PostgreSQL timestamp: ${String(value)}`);
  }
  return parsed;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid PostgreSQL integer: ${String(value)}`);
  }
  return parsed;
}

function text(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid PostgreSQL text value: ${String(value)}`);
  }
  return value;
}

function json(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function requiredRow<T>(row: T | undefined, label: string): T {
  if (!row) {
    throw new Error(`PostgreSQL did not return ${label}`);
  }
  return row;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
