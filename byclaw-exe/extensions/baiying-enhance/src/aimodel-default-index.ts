import { promises as fs } from "node:fs";
import path from "node:path";
import { MANAGED_PROVIDER_PREFIX } from "./types.js";
import { resolveStateDir } from "./workspace-paths.js";

/** Bump when the on-disk index shape changes incompatibly. */
export const AIMODEL_DEFAULT_LLM_INDEX_VERSION = 1;

export const AIMODEL_DEFAULT_LLM_INDEX_FILENAME = "aimodel-default-llm-index.json";

export type AimodelDefaultLlmIndexSnapshot = {
    redisKey: string;
    typelistField: string;
    typelistHash: string;
    modelRef: string;
    providerKey: string;
    instanceId: string;
    modelCode: string;
};

export type AimodelDefaultLlmIndexFile = AimodelDefaultLlmIndexSnapshot & {
    version: number;
    updatedAt: string;
};

export function resolveAimodelDefaultLlmIndexPath(stateDir?: string): string {
    const base = stateDir?.trim() || resolveStateDir();
    return path.join(base, "baiying-enhance", AIMODEL_DEFAULT_LLM_INDEX_FILENAME);
}

export function instanceIdFromManagedProviderKey(providerKey: string): string {
    const prefix = MANAGED_PROVIDER_PREFIX;
    const trimmed = providerKey.trim();
    if (!trimmed.startsWith(prefix)) {
        return "";
    }
    const rest = trimmed.slice(prefix.length);
    if (rest.startsWith("neg-")) {
        return `-${rest.slice("neg-".length)}`;
    }
    return rest;
}

export function buildAimodelDefaultLlmSnapshotFromBundle(params: {
    redisKey: string;
    typelistField: string;
    providerKey: string;
    modelRef: string;
    typelistHash: string;
    modelCode: string;
}): AimodelDefaultLlmIndexSnapshot {
    return buildAimodelDefaultLlmSnapshot({
        redisKey: params.redisKey,
        typelistField: params.typelistField,
        typelistHash: params.typelistHash,
        providerKey: params.providerKey,
        modelRef: params.modelRef,
        instanceId: instanceIdFromManagedProviderKey(params.providerKey),
        modelCode: params.modelCode,
    });
}

export function buildAimodelDefaultLlmSnapshot(params: {
    redisKey: string;
    typelistField: string;
    typelistHash: string;
    providerKey: string;
    modelRef: string;
    instanceId: string;
    modelCode: string;
}): AimodelDefaultLlmIndexSnapshot {
    return {
        redisKey: params.redisKey.trim(),
        typelistField: params.typelistField.trim(),
        typelistHash: params.typelistHash.trim(),
        modelRef: params.modelRef.trim(),
        providerKey: params.providerKey.trim(),
        instanceId: params.instanceId.trim(),
        modelCode: params.modelCode.trim(),
    };
}

export function aimodelDefaultLlmIndexChanged(
    previous: AimodelDefaultLlmIndexSnapshot | null,
    current: AimodelDefaultLlmIndexSnapshot,
): boolean {
    if (!previous) {
        return true;
    }
    return (
        previous.redisKey !== current.redisKey ||
        previous.typelistField !== current.typelistField ||
        previous.typelistHash !== current.typelistHash ||
        previous.modelRef !== current.modelRef ||
        previous.providerKey !== current.providerKey ||
        previous.instanceId !== current.instanceId ||
        previous.modelCode !== current.modelCode
    );
}

function parseSnapshot(raw: unknown): AimodelDefaultLlmIndexSnapshot | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const p = raw as Partial<AimodelDefaultLlmIndexFile>;
    const redisKey = typeof p.redisKey === "string" ? p.redisKey.trim() : "";
    const typelistField = typeof p.typelistField === "string" ? p.typelistField.trim() : "";
    const typelistHash = typeof p.typelistHash === "string" ? p.typelistHash.trim() : "";
    const modelRef = typeof p.modelRef === "string" ? p.modelRef.trim() : "";
    const providerKey = typeof p.providerKey === "string" ? p.providerKey.trim() : "";
    const instanceId = typeof p.instanceId === "string" ? p.instanceId.trim() : "";
    const modelCode = typeof p.modelCode === "string" ? p.modelCode.trim() : "";
    if (!typelistHash || !modelRef || !providerKey) {
        return null;
    }
    return {
        redisKey: redisKey || "byai:aimodel:typelist",
        typelistField: typelistField || "LLM",
        typelistHash,
        modelRef,
        providerKey,
        instanceId,
        modelCode,
    };
}

export async function loadAimodelDefaultLlmIndex(
    indexPath: string,
    log?: { warn: (m: string) => void },
): Promise<AimodelDefaultLlmIndexSnapshot | null> {
    let raw: string;
    try {
        raw = await fs.readFile(indexPath, "utf8");
    } catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") {
            log?.warn(`baiying-enhance: aimodel default LLM index invalid (not object): ${indexPath}`);
            return null;
        }
        const p = parsed as Partial<AimodelDefaultLlmIndexFile>;
        if (p.version !== AIMODEL_DEFAULT_LLM_INDEX_VERSION) {
            log?.warn(
                `baiying-enhance: aimodel default LLM index version mismatch (${String(p.version)} vs ${AIMODEL_DEFAULT_LLM_INDEX_VERSION}), ignoring: ${indexPath}`,
            );
            return null;
        }
        return parseSnapshot(p);
    } catch {
        log?.warn(`baiying-enhance: aimodel default LLM index corrupt, ignoring: ${indexPath}`);
        return null;
    }
}

export async function saveAimodelDefaultLlmIndex(
    indexPath: string,
    snapshot: AimodelDefaultLlmIndexSnapshot,
    log?: { warn: (m: string) => void },
): Promise<void> {
    const dir = path.dirname(indexPath);
    await fs.mkdir(dir, { recursive: true });
    const payload: AimodelDefaultLlmIndexFile = {
        version: AIMODEL_DEFAULT_LLM_INDEX_VERSION,
        updatedAt: new Date().toISOString(),
        ...snapshot,
    };
    const tmp = path.join(dir, `.${path.basename(indexPath)}.${process.pid}.tmp`);
    try {
        await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        await fs.rename(tmp, indexPath);
    } catch (err) {
        log?.warn(
            `baiying-enhance: failed to save aimodel default LLM index ${indexPath}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
        try {
            await fs.unlink(tmp);
        } catch {
            // ignore
        }
    }
}
