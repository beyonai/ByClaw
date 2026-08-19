import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const PORT = 18099;
const BASE_URL = `http://127.0.0.1:${PORT}/byaiService`;

process.env.BYAI_SERVICE_BASE_URL = BASE_URL;
process.env.BEYOND_TOKEN = "test-token";
process.env.USER_CODE = "tester";
delete process.env.BAIYING_DIGITAL_EMPLOYEE_ID;
delete process.env.DIGITAL_EMPLOYEE_ID;
delete process.env.RESOURCE_ID;
delete process.env.BYAI_WORKER_ID;
delete process.env.BAIYING_AGENT_AUTH;

const mod = await import("../scripts/by-skill-installer.mjs");
const {
  bindCommand,
  isInnerSkill,
  listCommand,
  resolveDigitalEmployeeId,
  resolveSkillIdByCode,
  resolveTargets,
  responseSucceeded,
  searchCommand,
  statusCommand,
  validateSkillCode,
} = mod;

// Backing store the fake backend serves and mutates.
const state = {
  skills: [
    { resourceId: 101, resourceCode: "fol-auto-biztravel", resourceName: "差旅助手", resourceBizType: "SKILL", skillType: "inner" },
    { resourceId: 102, resourceCode: "tech-article", resourceName: "技术文章", resourceBizType: "SKILL", skillType: "inner" },
    { resourceId: 103, resourceCode: "custom-skill", resourceName: "自定义", resourceBizType: "SKILL", skillType: "custom" },
    { resourceId: 104, resourceCode: "dup-code", resourceBizType: "SKILL", skillType: "inner" },
    { resourceId: 105, resourceCode: "dup-code", resourceBizType: "SKILL", skillType: "inner" },
  ],
  bound: new Map([[7, [102]]]),
  // Fault injection: make the backend accept a write but not persist it,
  // and make the permission list unavailable.
  swallowWrites: false,
  failAuthList: false,
};
const calls = [];

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
  });
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ code: 0, msg: "success", data }));
}

let server;

before(async () => {
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url, BASE_URL);
    calls.push({ path: url.pathname, body });

    if (url.pathname.endsWith("/auth/privilegeGrant/listResourceUseAuth")) {
      if (state.failAuthList) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 500, msg: "auth list unavailable" }));
        return;
      }
      const keyword = String(body.keyword || "");
      const list = state.skills.filter((s) => !keyword || s.resourceCode.includes(keyword));
      ok(res, { list, total: list.length });
      return;
    }
    if (url.pathname.endsWith("/digitalEmployeeController/queryRelResourceInfo")) {
      const relIds = state.bound.get(body.resourceId) ?? [];
      ok(res, state.skills.filter((s) => relIds.includes(s.resourceId)));
      return;
    }
    if (url.pathname.endsWith("/digitalEmployeeController/installRelResources")) {
      if (state.swallowWrites) {
        ok(res, true);
        return;
      }
      const existing = state.bound.get(body.digitalEmployeeId) ?? [];
      state.bound.set(body.digitalEmployeeId, [...new Set([...existing, ...body.relIds])]);
      ok(res, true);
      return;
    }
    if (url.pathname.endsWith("/digitalEmployeeController/uninstallRelResources")) {
      const existing = state.bound.get(body.digitalEmployeeId) ?? [];
      state.bound.set(body.digitalEmployeeId, existing.filter((id) => !body.relIds.includes(id)));
      ok(res, true);
      return;
    }
    res.writeHead(404).end("not found");
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("helpers", () => {
  it("accepts the success envelope variants", () => {
    assert.equal(responseSucceeded({ code: 0 }), true);
    assert.equal(responseSucceeded({ success: true }), true);
    assert.equal(responseSucceeded({ resultCode: 0 }), true);
    assert.equal(responseSucceeded({ code: 500 }), false);
    assert.equal(responseSucceeded(null), false);
  });

  it("rejects unsafe skill codes", () => {
    for (const bad of ["", "..", ".", ".hidden", "a/b", "a b", "a;rm"]) {
      assert.throws(() => validateSkillCode(bad), /skillCode/);
    }
    assert.equal(validateSkillCode(" tech-article "), "tech-article");
  });

  it("keeps only inner skills", () => {
    assert.equal(isInnerSkill({ skillType: "INNER" }), true);
    assert.equal(isInnerSkill({ skillType: "custom" }), false);
    assert.equal(isInnerSkill({}), false);
  });
});

describe("resolveTargets", () => {
  it("requires at least one handle", () => {
    assert.throws(() => resolveTargets({}), /--skill-code/);
  });

  it("pairs codes and ids positionally", () => {
    const targets = resolveTargets({ "skill-code": ["a", "b"], "skill-id": ["1", "2"] });
    assert.deepEqual(targets, [
      { skillCode: "a", skillId: 1 },
      { skillCode: "b", skillId: 2 },
    ]);
  });

  it("rejects mismatched counts", () => {
    assert.throws(() => resolveTargets({ "skill-code": ["a", "b"], "skill-id": ["1"] }), /数量必须一致/);
  });

  it("dedupes repeated handles", () => {
    assert.deepEqual(resolveTargets({ "skill-code": ["a", "a"] }), [{ skillCode: "a", skillId: undefined }]);
  });
});

describe("search", () => {
  it("returns all visible inner skills when no keyword is given", async () => {
    const result = await searchCommand({});
    assert.equal(result.ok, true);
    assert.equal(result.action, "search");
    assert.equal(result.keyword, null);
    assert.equal(result.visibleInnerSkillCount, 4);
    assert.equal(result.matchedCount, 4);
    const codes = result.skills.map((s) => s.skillCode).sort();
    assert.deepEqual(codes, ["dup-code", "dup-code", "fol-auto-biztravel", "tech-article"]);
  });

  it("filters by keyword matching code, name, or description", async () => {
    const result = await searchCommand({ keyword: "auto" });
    assert.equal(result.matchedCount, 1);
    assert.equal(result.skills[0].skillCode, "fol-auto-biztravel");
  });

  it("marks bound status when digital employee is resolved", async () => {
    const result = await searchCommand({ "digital-employee-id": "7" });
    const techArticle = result.skills.find((s) => s.skillCode === "tech-article");
    const biztravel = result.skills.find((s) => s.skillCode === "fol-auto-biztravel");
    assert.equal(techArticle.bound, true);
    assert.equal(biztravel.bound, false);
  });

  it("sets bound to null when digital employee cannot be resolved", async () => {
    const result = await searchCommand({});
    assert.equal(result.digitalEmployee.id, null);
    assert.match(result.digitalEmployee.unavailable, /--digital-employee-id/);
    assert.equal(result.skills.every((s) => s.bound === null), true);
  });

  it("supports --q as an alias for --keyword", async () => {
    const result = await searchCommand({ q: "tech" });
    assert.equal(result.matchedCount, 1);
    assert.equal(result.skills[0].skillCode, "tech-article");
  });

  it("accepts keyword as the second positional arg", async () => {
    const result = await searchCommand({ _: ["search", "biztravel"] });
    assert.equal(result.matchedCount, 1);
  });
});

describe("resolveDigitalEmployeeId", () => {
  it("prefers the explicit flag", () => {
    assert.deepEqual(resolveDigitalEmployeeId({ "digital-employee-id": "42" }), {
      digitalEmployeeId: 42,
      source: "flag",
    });
  });

  it("falls back to the environment", () => {
    process.env.BAIYING_DIGITAL_EMPLOYEE_ID = "77";
    try {
      assert.deepEqual(resolveDigitalEmployeeId({}), { digitalEmployeeId: 77, source: "env" });
    } finally {
      delete process.env.BAIYING_DIGITAL_EMPLOYEE_ID;
    }
  });

  it("derives the id from an OpenClaw workspace directory", () => {
    const original = process.cwd();
    const workspace = path.join(os.tmpdir(), "workspace-baiying-agent-321");
    fs.mkdirSync(workspace, { recursive: true });
    process.chdir(workspace);
    try {
      assert.deepEqual(resolveDigitalEmployeeId({}), { digitalEmployeeId: 321, source: "cwd" });
    } finally {
      process.chdir(original);
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("derives the id from BYAI_WORKER_ID", () => {
    process.env.BYAI_WORKER_ID = "openclaw-654";
    try {
      assert.deepEqual(resolveDigitalEmployeeId({}), {
        digitalEmployeeId: 654,
        source: "BYAI_WORKER_ID",
      });
    } finally {
      delete process.env.BYAI_WORKER_ID;
    }
  });

  it("derives the id from the BAIYING_AGENT_AUTH sub claim", () => {
    const payload = Buffer.from(JSON.stringify({ sub: 987 })).toString("base64url");
    process.env.BAIYING_AGENT_AUTH = `header.${payload}.sig`;
    try {
      assert.deepEqual(resolveDigitalEmployeeId({}), {
        digitalEmployeeId: 987,
        source: "BAIYING_AGENT_AUTH",
      });
    } finally {
      delete process.env.BAIYING_AGENT_AUTH;
    }
  });

  it("reads defaultDigitalEmployeeId out of the Beyond-Token", () => {
    const payload = Buffer.from(JSON.stringify({ defaultDigitalEmployeeId: 88 })).toString("base64url");
    process.env.BEYOND_TOKEN = `header.${payload}.sig`;
    try {
      assert.deepEqual(resolveDigitalEmployeeId({}), { digitalEmployeeId: 88, source: "beyond-token" });
    } finally {
      process.env.BEYOND_TOKEN = "test-token";
    }
  });

  it("fails loudly when nothing identifies the agent", () => {
    assert.throws(() => resolveDigitalEmployeeId({}), /--digital-employee-id/);
  });
});

describe("resolveSkillIdByCode", () => {
  it("maps resourceCode to resourceId", async () => {
    const resolved = await resolveSkillIdByCode({ skillCode: "fol-auto-biztravel", timeoutMs: 5000 });
    assert.equal(resolved.skillId, 101);
    assert.equal(resolved.skillCode, "fol-auto-biztravel");
    assert.equal(resolved.skillType, "inner");
  });

  it("hides non-inner skills", async () => {
    await assert.rejects(
      resolveSkillIdByCode({ skillCode: "custom-skill", timeoutMs: 5000 }),
      /未找到/,
    );
  });

  it("asks for --skill-id when a code is ambiguous", async () => {
    await assert.rejects(
      resolveSkillIdByCode({ skillCode: "dup-code", timeoutMs: 5000 }),
      /--skill-id/,
    );
  });
});

describe("bind / unbind / list / status", () => {
  it("dry-run reports the pending change without calling the mutation", async () => {
    calls.length = 0;
    const result = await bindCommand({
      "skill-code": "fol-auto-biztravel",
      "digital-employee-id": "7",
      "dry-run": true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.wouldChange, ["fol-auto-biztravel"]);
    assert.equal(calls.some((c) => c.path.endsWith("/installRelResources")), false);
    assert.deepEqual(state.bound.get(7), [102]);
  });

  it("binds a resolved inner skill", async () => {
    const result = await bindCommand({ "skill-code": "fol-auto-biztravel", "digital-employee-id": "7" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.changed, ["fol-auto-biztravel"]);
    assert.deepEqual(state.bound.get(7), [102, 101]);
  });

  it("skips a skill that is already bound", async () => {
    calls.length = 0;
    const result = await bindCommand({ "skill-code": "tech-article", "digital-employee-id": "7" });
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.alreadyInDesiredState, ["tech-article"]);
    assert.equal(calls.some((c) => c.path.endsWith("/installRelResources")), false);
  });

  it("lists bound skills with their inner flag", async () => {
    const result = await listCommand({ "digital-employee-id": "7" });
    assert.equal(result.boundSkillCount, 2);
    assert.deepEqual(result.skills.map((s) => s.skillCode), ["fol-auto-biztravel", "tech-article"]);
    assert.equal(result.skills.every((s) => s.inner), true);
  });

  it("status reports resolution plus binding state", async () => {
    const result = await statusCommand({
      "skill-code": ["fol-auto-biztravel", "custom-skill"],
      "digital-employee-id": "7",
    });
    assert.equal(result.ok, false);
    assert.equal(result.digitalEmployee.id, 7);
    const bound = result.items.find((i) => i.skillCode === "fol-auto-biztravel");
    assert.equal(bound.bound, true);
    assert.match(result.items.find((i) => i.skillCode === "custom-skill").error, /未找到/);
  });

  it("unbinds and then reports the no-op", async () => {
    const first = await bindCommand(
      { "skill-code": "fol-auto-biztravel", "digital-employee-id": "7" },
      { unbind: true },
    );
    assert.deepEqual(first.changed, ["fol-auto-biztravel"]);
    assert.deepEqual(state.bound.get(7), [102]);

    const second = await bindCommand(
      { "skill-code": "fol-auto-biztravel", "digital-employee-id": "7" },
      { unbind: true },
    );
    assert.deepEqual(second.changed, []);
    assert.deepEqual(second.alreadyInDesiredState, ["fol-auto-biztravel"]);
  });

  it("bypasses resolution when --skill-id is given", async () => {
    const result = await bindCommand({ "skill-id": "103", "digital-employee-id": "9" });
    assert.equal(result.ok, true);
    assert.deepEqual(state.bound.get(9), [103]);
  });

  it("fails when the backend accepts the write but does not persist it", async () => {
    state.swallowWrites = true;
    try {
      const result = await bindCommand({ "skill-code": "fol-auto-biztravel", "digital-employee-id": "11" });
      assert.equal(result.ok, false, "写入未生效时 ok 必须为 false");
      assert.deepEqual(result.changed, []);
      assert.deepEqual(result.verifyFailed, [{ skillCode: "fol-auto-biztravel", skillId: 101 }]);
    } finally {
      state.swallowWrites = false;
    }
  });

  it("keeps list usable when skillType enrichment is unavailable", async () => {
    state.failAuthList = true;
    try {
      const result = await listCommand({ "digital-employee-id": "7" });
      assert.equal(result.ok, true, "补全失败不应让 list 整体失败");
      assert.match(result.skillTypeEnrichment, /^unavailable: /);
      // queryRelResourceInfo 自身带 skillType 的条目仍应判定为 inner。
      assert.equal(result.skills.every((s) => s.inner === true), true);
    } finally {
      state.failAuthList = false;
    }
  });

  it("marks inner as null when skillType cannot be determined", async () => {
    state.skills.push({ resourceId: 106, resourceCode: "typeless", resourceBizType: "SKILL" });
    state.bound.set(12, [106]);
    state.failAuthList = true;
    try {
      const result = await listCommand({ "digital-employee-id": "12" });
      const entry = result.skills.find((s) => s.skillCode === "typeless");
      assert.equal(entry.skillType, "");
      assert.equal(entry.inner, null, "未知 skillType 应为 null 而非 false");
    } finally {
      state.failAuthList = false;
      state.skills = state.skills.filter((s) => s.resourceId !== 106);
      state.bound.delete(12);
    }
  });

  it("reports skillType enrichment as the auth-list source on the happy path", async () => {
    const result = await listCommand({ "digital-employee-id": "7" });
    assert.equal(result.skillTypeEnrichment, "auth-list");
  });
});
