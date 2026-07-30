import {
  generateKeyPairSync,
  sign as signPayload,
  type KeyObject,
} from "node:crypto";
import {
  ConnectorRegistry,
  DelegationService,
  InMemoryDelegationRepository,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemorySessionRepository,
  RunService,
  type LeaderSessionFactory,
} from "@byclaw/by-conductor";
import { createBeyondTokenVerifier } from "../../app/auth/beyond-token.js";
import { RunIngressService } from "../../app/ingress/run-ingress-service.js";
import { buildHttpApp } from "../../app/server/app.js";

export interface TestService {
  baseUrl: string;
  token(userCode: string): string;
  close(): Promise<void>;
}

/**
 * 启动监听真实随机端口的轻量 E2E 服务。
 *
 * HTTP、SSE、JWT 验签和编排服务均使用生产实现；数据库、模型和 Agent Catalog
 * 使用确定性内存替身，保证本地和 CI 无外部依赖即可运行。
 */
export async function startTestService(ready = true): Promise<TestService> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const service = createRunService();
  const app = await buildHttpApp({
    runService: service,
    corsOrigin: true,
    runIngress: new RunIngressService(
      service,
      createBeyondTokenVerifier({
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
      }),
      { listAuthorizedAgents: async () => [] },
    ),
    readiness: async () => ({
      ready,
      pi: ready
        ? { healthy: true, model: "e2e/fake-model" }
        : { healthy: false, message: "model unavailable" },
      connectors: {},
      worker: { enabled: false, healthy: true },
    }),
  });
  const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });

  return {
    baseUrl,
    token: (userCode) => createToken(privateKey, userCode),
    async close() {
      await app.close();
      await service.dispose();
    },
  };
}

function createRunService(): RunService {
  const sessions = new InMemorySessionRepository();
  const runs = new InMemoryRunRepository(sessions);
  const delegations = new InMemoryDelegationRepository();
  const events = new InMemoryRunEventStore();
  const registry = new ConnectorRegistry();
  const delegationService = new DelegationService(
    registry,
    delegations,
    events,
    1_000,
  );
  const leaders: LeaderSessionFactory = {
    async create() {
      return {
        contextRevision: 0,
        async run(input) {
          await input.onDelta("answer:");
          await input.onDelta(input.message);
          return { text: `answer:${input.message}` };
        },
        async abort() {},
        checkpoint() {
          return undefined;
        },
        markCommitted() {},
        dispose() {},
      };
    },
    async health() {
      return { healthy: true, model: "e2e/fake-model" };
    },
  };
  let now = 1_000_000;
  return new RunService(
    sessions,
    runs,
    delegations,
    events,
    delegationService,
    leaders,
    () => ++now,
  );
}

function createToken(privateKey: KeyObject, userCode: string): string {
  const header = encodeJwtPart({ alg: "RS256", typ: "JWT" });
  const payload = encodeJwtPart({
    userCode,
    exp: Math.floor(Date.now() / 1_000) + 300,
  });
  const content = `${header}.${payload}`;
  const signature = signPayload(
    "RSA-SHA256",
    Buffer.from(content),
    privateKey,
  ).toString("base64url");
  return `${content}.${signature}`;
}

function encodeJwtPart(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
