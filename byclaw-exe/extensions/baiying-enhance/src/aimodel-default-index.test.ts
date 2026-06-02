import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    AIMODEL_DEFAULT_LLM_INDEX_VERSION,
    aimodelDefaultLlmIndexChanged,
    buildAimodelDefaultLlmSnapshot,
    loadAimodelDefaultLlmIndex,
    saveAimodelDefaultLlmIndex,
} from "./aimodel-default-index.js";

const baseSnapshot = buildAimodelDefaultLlmSnapshot({
    redisKey: "byai:aimodel:typelist",
    typelistField: "LLM",
    typelistHash: "hash-a",
    providerKey: "baiying-m-10004014",
    modelRef: "baiying-m-10004014/deepseek-v4-flash",
    instanceId: "10004014",
    modelCode: "deepseek-v4-flash",
});

describe("aimodel-default-index", () => {
    let tempDir: string | undefined;

    afterEach(() => {
        tempDir = undefined;
    });

    it("detects first run and typelist hash changes", () => {
        expect(aimodelDefaultLlmIndexChanged(null, baseSnapshot)).toBe(true);
        expect(aimodelDefaultLlmIndexChanged(baseSnapshot, baseSnapshot)).toBe(false);
        expect(
            aimodelDefaultLlmIndexChanged(
                baseSnapshot,
                buildAimodelDefaultLlmSnapshot({ ...baseSnapshot, typelistHash: "hash-b" }),
            ),
        ).toBe(true);
        expect(
            aimodelDefaultLlmIndexChanged(
                baseSnapshot,
                buildAimodelDefaultLlmSnapshot({ ...baseSnapshot, modelRef: "baiying-m-10004019/kimi-k2.6" }),
            ),
        ).toBe(true);
    });

    it("persists and reloads index file", async () => {
        tempDir = await mkdtemp(path.join(tmpdir(), "aimodel-default-index-"));
        const indexPath = path.join(tempDir, "aimodel-default-llm-index.json");
        await saveAimodelDefaultLlmIndex(indexPath, baseSnapshot);
        const loaded = await loadAimodelDefaultLlmIndex(indexPath);
        expect(loaded).toEqual(baseSnapshot);
        const raw = JSON.parse(await readFile(indexPath, "utf8")) as { version: number };
        expect(raw.version).toBe(AIMODEL_DEFAULT_LLM_INDEX_VERSION);
    });
});
