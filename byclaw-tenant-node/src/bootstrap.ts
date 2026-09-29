import { join } from "node:path";
import { Redis } from "ioredis";
import type { Config } from "./config.js";
import { ConnectionManager } from "./application/connection-manager.js";
import { CommandService } from "./application/command-service.js";
import { HistoryService } from "./application/history.js";
import { SessionQueries } from "./application/session-queries.js";
import { MirrorService } from "./application/mirror-service.js";
import { SchemaTaskService } from "./application/schema/task-service.js";
import { TenantRuntime } from "./application/runtime.js";
import { Database } from "./infrastructure/persistence/database.js";
import { SqlCommandTransactions } from "./infrastructure/persistence/command-repository.js";
import { SqlMirrorTransactions } from "./infrastructure/persistence/mirror-repository.js";
import { SqlSessionRepository } from "./infrastructure/persistence/session-repository.js";
import { SqlHistoryRepository } from "./infrastructure/persistence/history-repository.js";
import { JsonStore } from "./infrastructure/files/json-store.js";
import { readTenantSnapshot } from "./infrastructure/connection/redis-config.js";
import { decryptPassword } from "./infrastructure/connection/kms-decryptor.js";
import { MtlsClient, loadTls } from "./infrastructure/http/mtls-client.js";
import { BeSchemaClient } from "./infrastructure/schema/be-schema-client.js";
import { SchemaTaskFiles } from "./infrastructure/schema/task-files.js";
import { schemaPorts } from "./infrastructure/schema/task-adapter.js";
import { SchemaReadiness } from "./infrastructure/schema/readiness.js";
import { StreamSupervisor } from "./infrastructure/stream/stream-supervisor.js";
import { Discovery } from "./infrastructure/discovery/by-framework-discovery.js";
import { TenantWorker } from "./infrastructure/discovery/tenant-worker.js";
import { createApp } from "./interfaces/http/app.js";

export async function bootstrap(config: Config) {
  const tls = await loadTls(config),
    client = new MtlsClient(tls, config.internalToken);
  const redis = new Redis({ ...config.redis, lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on("error", () => {});
  const state = new JsonStore(config.stateDir);
  const connection = new ConnectionManager(config, {
    snapshot: () => readTenantSnapshot(redis, config.enterpriseId),
    decrypt: (snapshot) => decryptPassword(client, config.kmsUrl, snapshot),
    open: Database.open,
    readAuthority: () => state.read("authority.json"),
    saveAuthority: (snapshot) =>
      state.write("authority.json", {
        generation: snapshot.generation,
        credentialVersion: snapshot.credentialVersion,
        fencingToken: snapshot.fencingToken,
      }),
  });
  const read = {
    query: (sql: string, parameters?: unknown[]) => connection.database().query(sql, parameters),
  };
  const history = new HistoryService(
    config.enterpriseId,
    new SqlHistoryRepository(read, config.enterpriseId),
  );
  const commands = new CommandService(new SqlCommandTransactions(connection));
  const be = new BeSchemaClient(config, client),
    schemaState = new SchemaReadiness(connection, be);
  const schema = new SchemaTaskService(
    schemaPorts(
      connection,
      new SchemaTaskFiles(
        new JsonStore(join(config.stateDir, "schema-tasks", `g${config.generation}`)),
      ),
      be,
    ),
  );
  const mirror = new MirrorService(new SqlMirrorTransactions(connection));
  const streams = new StreamSupervisor(config, mirror, () => connection.ready);
  const discovery = new Discovery(redis, config);
  const worker = new TenantWorker(redis, config, {
    commands,
    history,
    schema,
    ready: (): boolean => runtime.ready,
    schemaState: () => schemaState.state,
  });
  const runtime = new TenantRuntime(connection, schema, {
    worker,
    discovery,
    streams,
    checkSchema: () => schemaState.check(),
    schemaState: () => schemaState.state,
    warn: (code) => app.log.warn({ code }, "Tenant reconciliation deferred"),
  });
  const app = createApp(
    config,
    {
      commands,
      mirror,
      history,
      schema,
      sessions: new SessionQueries(new SqlSessionRepository(read, config.enterpriseId)),
      connected: () => connection.connected,
      ready: (): boolean => runtime.ready,
      provisioned: () => runtime.provisioned,
      schemaState: () => schemaState.state,
      health: () => runtime.health(),
    },
    tls,
  );
  return {
    app,
    runtime,
    async close() {
      await runtime.stop();
      await app.close();
      await connection.close();
      redis.disconnect();
      client.close();
    },
  };
}
