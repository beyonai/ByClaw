import { describe, expect, it } from "vitest";
import { CommandService } from "../src/application/command-service.js";
import { SqlCommandTransactions } from "../src/infrastructure/persistence/command-repository.js";
import type { ConnectionManager } from "../src/application/connection-manager.js";
import type { TenantCommand } from "../src/application/command.js";
import { HistoryService } from "../src/application/history.js";
import { SqlHistoryRepository } from "../src/infrastructure/persistence/history-repository.js";

// An SQL boundary fixture: execute the real authorization, command and child writer.
function setup() {
  let sequence = 1;
  const tables: Record<string, Record<string, any>[]> = {
    byai_session: [
      {
        session_id: "50",
        enterprise_id: "10",
        creator_id: "20",
        session_type: "h_as",
        object_id: "42",
        project_id: "-1",
      },
    ],
    byai_session_ext: [],
    byai_message: [],
  };
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("nextval(")) return [{ id: String(sequence++) }];
    const match = sql.match(/^INSERT INTO byai\.(\w+) \(([^)]+)\)/);
    if (match) {
      tables[match[1]]!.push(
        Object.fromEntries(match[2].split(",").map((name, index) => [name, params[index]])),
      );
      return [];
    }
    if (sql.includes("FROM byai.byai_session_ext"))
      return tables.byai_session_ext.filter(
        (row) =>
          row.session_id === params[0] &&
          (params[1] === undefined || row.ext_param_code === params[1]),
      );
    if (sql.startsWith("UPDATE byai.byai_message SET")) {
      const message = tables.byai_message.find((row) => params.includes(row.message_id));
      if (!message) throw new Error("missing message");
      for (const assignment of sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).split(",")) {
        const bound = assignment.trim().match(/^(\w+)\s*=\s*\$(\d+)$/);
        if (bound) message[bound[1]] = params[Number(bound[2]) - 1];
      }
      message.storage_version = String(Number(message.storage_version) + 1);
      return sql.includes("RETURNING") ? [{ ...message }] : [];
    }
    if (sql.startsWith("UPDATE byai.byai_session_ext")) {
      const extension = tables.byai_session_ext.find((row) => row.ext_id === params[1]);
      if (extension) extension.ext_param_value = params[0];
      return [];
    }
    if (sql.includes("FROM byai.byai_message m JOIN byai.byai_session s")) {
      const rows = tables.byai_message.filter(
        (row) => row.enterprise_id === params[0] && row.session_id === params[1],
      );
      return sql.includes("COUNT(*)") ? [{ total: rows.length }] : rows;
    }
    if (sql.includes("FROM byai.byai_message"))
      return tables.byai_message.filter(
        (row) => row.message_id === params[0] && row.enterprise_id === params[1],
      );
    if (sql.includes("FROM byai.byai_session WHERE"))
      return tables.byai_session.filter(
        (row) => row.session_id === params[0] && row.enterprise_id === params[1],
      );
    return [];
  };
  const connection = {
    write: async (work: (db: { query: typeof query }) => unknown) => work({ query }),
  };
  const service = new CommandService(
    new SqlCommandTransactions(connection as unknown as ConnectionManager),
  );
  const command = (requestId: string, enterpriseId = "10"): TenantCommand => ({
    protocolVersion: 1,
    enterpriseId,
    generation: "1",
    dbSandboxRecordId: "9",
    userId: "20",
    requestId,
    sessionId: "50",
    operation: "ENSURE_EXTERNAL_CHILD" as TenantCommand["operation"],
    tenantMemberUserIds: ["20"],
    requestHash: requestId,
    payload: {
      externalSessionId: "dsh-child",
      externalRootSessionId: "dsh-root",
      childName: "开发成员",
    },
  });
  return {
    service,
    command,
    tables,
    history: new HistoryService("10", new SqlHistoryRepository({ query }, "10")),
  };
}

describe("tenant external child binding", () => {
  it("assigns a durable history sequence to the child message", async () => {
    const { service, command } = setup();
    const binding = await service.execute(command("binding"));
    expect(binding.data.session.lastSeq).toBe("1");
    expect(binding.data.message.createdSeq).toBe("1");
  });
  it("persists an explicit final body and returns the committed storage version", async () => {
    const { service, command, tables, history } = setup();
    const binding = await service.execute(command("binding"));
    const write = command("write");
    write.operation = "SAVE_EXTERNAL_CHILD";
    write.payload = {
      childSessionId: binding.data.session.sessionId,
      messageId: binding.data.message.messageId,
      expectedStreamId: null,
      streamId: "100-0",
      messageContent: "Delivered",
      finalContent: "Delivered",
      messageStruct: [],
      inferLog: [],
      metadata: { session_scope: "child", external_session_id: "dsh-child" },
      complete: true,
    };
    const result = await service.execute(write);
    expect(result.data.message.storageVersion).toBe("1");
    expect(result.data.message.finalContent).toBe("Delivered");
    expect(result.data.message.complete).toBe(true);
    const reloaded = await service.execute(command("reload"));
    expect(reloaded.data.message.finalContent).toBe("Delivered");
    expect(JSON.parse(reloaded.data.message.metadata).event_stream_id).toBe("100-0");
    const page = await history.traditional("20", binding.data.session.sessionId, 1, 20);
    expect(page.total).toBe(1);
    expect(page.list[0]).toMatchObject({
      messageContent: "Delivered",
      finalContent: "Delivered",
      complete: true,
    });
    await expect(history.traditional("21", binding.data.session.sessionId, 1, 20)).rejects.toThrow(
      "RESOURCE_NOT_ACCESSIBLE",
    );
    expect(tables.byai_message).toHaveLength(1);
  });
  it("creates stable child and message IDs in the owning tenant and reloads them", async () => {
    const { service, command, tables } = setup();
    const first = await service.execute(command("first"));
    const second = await service.execute(command("second"));
    expect(first.data.session.parentSessionId).toBe("50");
    expect(first.data.session.enterpriseId).toBe("10");
    expect(first.data.session.sessionName).toBe("开发成员");
    expect(second.data.session.sessionId).toBe(first.data.session.sessionId);
    expect(second.data.message.messageId).toBe(first.data.message.messageId);
    expect(tables.byai_session).toHaveLength(2);
    expect(tables.byai_message).toHaveLength(1);
  });
  it("does not bind a foreign tenant parent", async () => {
    const { service, command, tables } = setup();
    await expect(service.execute(command("foreign", "11"))).rejects.toThrow(
      "RESOURCE_NOT_ACCESSIBLE",
    );
    expect(tables.byai_session).toHaveLength(1);
    expect(tables.byai_message).toHaveLength(0);
  });
  it("rejects a child snapshot whose read watermark is stale", async () => {
    const { service, command } = setup();
    const binding = await service.execute(command("binding"));
    const write = command("write");
    write.operation = "SAVE_EXTERNAL_CHILD" as TenantCommand["operation"];
    write.payload = {
      childSessionId: binding.data.session.sessionId,
      messageId: binding.data.message.messageId,
      expectedStreamId: "99-0",
      streamId: "100-0",
      messageContent: "hello",
      messageStruct: [],
      inferLog: [],
      metadata: {},
      complete: false,
    };
    await expect(service.execute(write)).rejects.toThrow("VERSION_CONFLICT");
  });
});
