import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MAIN_AGENTS_MARKER,
  MAIN_CONTEXT_MARKER,
} from "./main-workspace-seed.js";
import { MANAGED_SEED_MARKER, isManagedSeedContent } from "./workspace-seed.js";
import {
  parseMainWorkspaceContextTemplate,
  resolveMainContextTemplateParamCode,
} from "./main-context-template.js";

/**
 * 卡片 0009 · 托管文件只读回归（AC-013）。
 *
 * 【只读】本文件**不修改任何插件实现**，只断言"生成内容不含四类已下线资源元数据"与
 * "无托管标记的用户文件不被覆盖"这两条既有事实。
 *
 * 【零 mock】`main-workspace-seed.ts` 的 `openclaw/plugin-sdk/compat` 是 `import type`（运行时擦除），
 * 故该模块可直接导入，规避卡片 0012 记录的插件测试基建缺陷。
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** 四类已下线资源在生成内容里的可达形态：类型码、资源 id 形态、以及中文能力名。 */
const DISABLED_TOKENS = [
  "OBJECT_",
  "VIEW_",
  "ONTOLOGY_BASE_",
  "SCENE_",
  "ONTOLOGY_BASE",
  "OBJECT",
  "VIEW",
  "SCENE",
];

describe("主工作区托管文件不含四类已下线资源元数据", () => {
  it("main-workspace-seed / main-context-template 源文件零命中四类资源引用", () => {
    for (const file of ["main-workspace-seed.ts", "main-context-template.ts"]) {
      const source = readFileSync(path.join(here, file), "utf8");
      for (const token of DISABLED_TOKENS) {
        expect(source, `${file} 不应出现 ${token}`).not.toContain(token);
      }
    }
  });

  it("导出的托管标记常量可零 mock 读取且不含四类元数据", () => {
    expect(MAIN_AGENTS_MARKER).toContain("<!-- baiying-enhance:");
    expect(MAIN_CONTEXT_MARKER).toContain("<!-- baiying-enhance:");
    for (const marker of [MAIN_AGENTS_MARKER, MAIN_CONTEXT_MARKER, MANAGED_SEED_MARKER]) {
      for (const token of DISABLED_TOKENS) {
        expect(marker).not.toContain(token);
      }
    }
  });

  it("主工作区上下文模板仍覆盖 SOUL.md / TOOLS.md（能力未被本卡删除）", () => {
    const template = parseMainWorkspaceContextTemplate({
      key: "test",
      raw: JSON.stringify({
        templateType: "agentContext",
        scope: "mainWorkspace",
        schemaVersion: 1,
        files: {
          "SOUL.md": { priorityPrompt: "soul", mergeStrategy: "append" },
          "TOOLS.md": { priorityPrompt: "tools", mergeStrategy: "replace" },
        },
      }),
    });
    const fileNames = Object.keys(template?.files ?? {});
    expect(fileNames).toContain("SOUL.md");
    expect(fileNames).toContain("TOOLS.md");
    expect(resolveMainContextTemplateParamCode(undefined)).toBeTruthy();
  });

  it("无托管标记的用户文件不被覆盖（整文件级判据）", () => {
    // 用户手工维护的文件：不以托管标记开头 ⇒ isManagedSeedContent 为 false ⇒ 不会被整体重写。
    expect(isManagedSeedContent("# 我的手工 TOOLS.md\n\n自定义内容")).toBe(false);
    // 受管文件：以标记开头 ⇒ 允许在下一次 seed 时整体重写为最新生成内容。
    expect(isManagedSeedContent(`${MANAGED_SEED_MARKER}\n\n# generated`)).toBe(true);
  });

  it("主工作区 seed 的模板加载入口不含四类资源元数据", async () => {
    // 只读断言：主工作区上下文模板的加载/解析入口（本卡 AC-013 的范围）不含四类元数据。
    // 说明：agent 工作区的 workspace-seed.ts 生成内容属卡片 0008 的范围，本卡不在此断言（见 development-report 的跨卡边界）。
    const { loadMainWorkspaceContextTemplate } = await import("./main-context-template.js");
    expect(typeof loadMainWorkspaceContextTemplate).toBe("function");
    const source = readFileSync(path.join(here, "main-context-template.ts"), "utf8");
    for (const token of DISABLED_TOKENS) {
      expect(source, `main-context-template.ts 不应出现 ${token}`).not.toContain(token);
    }
  });
});
