import { describe, expect, it } from "vitest";
import { databaseStream } from "../src/infrastructure/connection/private-database-stream.js";

describe("private PostgreSQL transport", () => {
  it.each([
    "ws://15432-sbx.cn-beijing-vpc.sandbox.aliyuncs.com/postgresql",
    "wss://15432-sbx.cn-beijing.sandbox.aliyuncs.com/postgresql",
    "wss://15432-sbx.cn-beijing-vpc.sandbox.aliyuncs.com/other",
    "wss://15432-sbx.cn-beijing-vpc.sandbox.aliyuncs.com/postgresql?target=other",
    "wss://user@15432-sbx.cn-beijing-vpc.sandbox.aliyuncs.com/postgresql",
    "wss://15432-sbx.cn-beijing-vpc.sandbox.aliyuncs.com:8443/postgresql",
    "wss://127.0.0.1/postgresql",
  ])("rejects public, redirected or client-selected targets: %s", (url) => {
    expect(() => databaseStream({ url, trafficToken: "fixture" })).toThrow();
  });
  it("rejects a missing traffic credential before opening a socket", () => {
    expect(() =>
      databaseStream({
        url: "wss://15432-sbx.cn-beijing-vpc.sandbox.aliyuncs.com/postgresql",
        trafficToken: "",
      }),
    ).toThrow();
  });
});
