import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { getCachedAimodelAuthToken } from "./aimodel-auth-cache.js";
import {
    decodeBaiyingAimodelSecretRefId,
    type ResolvedDefaultBaiyingAimodelProviderBundle,
} from "./aimodel-config.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";

const DEFAULT_ZREAD_COMMAND = "zread";
const DEFAULT_ZREAD_CONFIG_TIMEOUT_MS = 30_000;
const MAX_STDERR_BYTES = 16_384;

type LoggerLike = {
    info: (message: string) => void;
    warn: (message: string) => void;
};

export type ZreadModelSyncSettings = {
    enabled: boolean;
    command: string;
    configTimeoutMs: number;
};

export type ZreadConfigFields = {
    llm_provider: string;
    llm_base_url: string;
    llm_model: string;
    llm_api_key: string;
};

export type ZreadConfigRequest = {
    command: string;
    args?: string[];
    fields: ZreadConfigFields;
    timeoutMs: number;
};

type ZreadConfigRunner = (request: ZreadConfigRequest) => Promise<void>;

type ZreadStdioEvent = {
    waiting_for?: unknown;
    done?: unknown;
    error?: unknown;
};

function positiveInt(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback;
}

export function resolveZreadModelSyncSettings(
    config: BaiyingEnhancePluginConfig,
): ZreadModelSyncSettings {
    return {
        enabled: config.zreadModelSyncEnabled !== false,
        command: config.zreadCommand?.trim() || DEFAULT_ZREAD_COMMAND,
        configTimeoutMs: positiveInt(
            config.zreadConfigTimeoutMs,
            DEFAULT_ZREAD_CONFIG_TIMEOUT_MS,
        ),
    };
}

function redactSecrets(message: string, secrets: string[]): string {
    let redacted = message;
    for (const secret of secrets) {
        if (secret) {
            redacted = redacted.split(secret).join("<redacted>");
        }
    }
    return redacted;
}

function appendBounded(current: string, chunk: string): string {
    const next = current + chunk;
    return next.length <= MAX_STDERR_BYTES
        ? next
        : next.slice(next.length - MAX_STDERR_BYTES);
}

export async function runZreadConfigStdio(request: ZreadConfigRequest): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(request.command, request.args ?? ["config", "--stdio"], {
            stdio: ["pipe", "pipe", "pipe"],
        });
        const secrets = [request.fields.llm_api_key];
        let stdoutBuffer = "";
        let stderr = "";
        let updateSent = false;
        let saveSent = false;
        let sawDone = false;
        let settled = false;

        const timer = setTimeout(() => {
            fail(new Error(`zread config timed out after ${request.timeoutMs}ms`));
        }, request.timeoutMs);
        timer.unref?.();

        const finish = (error?: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (error) {
                child.kill("SIGTERM");
                reject(new Error(redactSecrets(error.message, secrets)));
                return;
            }
            resolve();
        };

        function fail(error: Error): void {
            const detail = stderr.trim();
            finish(
                detail
                    ? new Error(`${error.message}: ${redactSecrets(detail, secrets)}`)
                    : error,
            );
        }

        const send = (type: "update_fields" | "save", params: Record<string, unknown>) => {
            child.stdin.write(`${JSON.stringify({ type, params })}\n`);
        };

        const handleLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }
            let event: ZreadStdioEvent;
            try {
                event = JSON.parse(trimmed) as ZreadStdioEvent;
            } catch {
                fail(new Error("zread config emitted invalid JSON on stdout"));
                return;
            }
            if (typeof event.error === "string" && event.error.trim()) {
                fail(new Error(`zread config rejected the update: ${event.error.trim()}`));
                return;
            }
            if (event.done === true) {
                sawDone = true;
                return;
            }
            const waitingFor = Array.isArray(event.waiting_for)
                ? event.waiting_for.filter((value): value is string => typeof value === "string")
                : [];
            if (!updateSent && waitingFor.includes("update_fields")) {
                updateSent = true;
                send("update_fields", { fields: request.fields });
                return;
            }
            if (updateSent && !saveSent && waitingFor.includes("save")) {
                saveSent = true;
                send("save", {});
            }
        };

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            stdoutBuffer += chunk;
            for (;;) {
                const newline = stdoutBuffer.indexOf("\n");
                if (newline < 0) {
                    break;
                }
                const line = stdoutBuffer.slice(0, newline);
                stdoutBuffer = stdoutBuffer.slice(newline + 1);
                handleLine(line);
            }
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr = appendBounded(stderr, chunk);
        });
        child.stdin.on("error", (error) => {
            if (!sawDone) {
                fail(error);
            }
        });
        child.on("error", (error) => fail(error));
        child.on("close", (code, signal) => {
            if (settled) {
                return;
            }
            if (stdoutBuffer.trim()) {
                handleLine(stdoutBuffer);
            }
            if (settled) {
                return;
            }
            if (code === 0 && sawDone && updateSent && saveSent) {
                finish();
                return;
            }
            fail(
                new Error(
                    `zread config exited before completing (code=${code ?? "null"}, signal=${signal ?? "none"})`,
                ),
            );
        });
    });
}

function resolveCredentialModelId(apiKey: unknown): string {
    if (!apiKey || typeof apiKey !== "object") {
        return "";
    }
    const ref = apiKey as { source?: unknown; id?: unknown };
    if (ref.source !== "exec" || typeof ref.id !== "string") {
        return "";
    }
    return decodeBaiyingAimodelSecretRefId(ref.id).trim();
}

export function resolveZreadConfigFields(
    resolved: ResolvedDefaultBaiyingAimodelProviderBundle,
): ZreadConfigFields {
    if (
        resolved.provider.api !== "openai-completions" &&
        resolved.provider.api !== "openai-responses"
    ) {
        throw new Error(
            `Zread model sync does not support provider API ${resolved.provider.api}`,
        );
    }
    const credentialModelId = resolveCredentialModelId(resolved.provider.apiKey);
    const apiKey = credentialModelId
        ? getCachedAimodelAuthToken(credentialModelId)
        : null;
    if (!apiKey) {
        throw new Error("Zread model sync could not resolve the cached Redis authToken");
    }
    return {
        llm_provider: "custom",
        llm_base_url: resolved.provider.baseUrl,
        llm_model: resolved.provider.modelId,
        llm_api_key: apiKey,
    };
}

async function secureZreadConfigFile(): Promise<void> {
    await chmod(path.join(homedir(), ".zread", "config.yaml"), 0o600);
}

export function createZreadDefaultModelSync(params: {
    settings: ZreadModelSyncSettings;
    logger: LoggerLike;
    runConfig?: ZreadConfigRunner;
    secureConfigFile?: () => Promise<void>;
}) {
    const runConfig = params.runConfig ?? runZreadConfigStdio;
    const secureConfigFile = params.secureConfigFile ?? secureZreadConfigFile;
    let queue = Promise.resolve();
    let workerActive = false;
    let lastAppliedSignature = "";
    let lastRejectedSignature = "";
    let desired:
        | { fields: ZreadConfigFields; signature: string }
        | null = null;

    const startWorker = (): void => {
        if (workerActive) {
            return;
        }
        workerActive = true;
        queue = (async () => {
            try {
                while (desired) {
                    const current = desired;
                    desired = null;
                    if (current.signature === lastAppliedSignature) {
                        continue;
                    }
                    try {
                        await runConfig({
                            command: params.settings.command,
                            fields: current.fields,
                            timeoutMs: params.settings.configTimeoutMs,
                        });
                        await secureConfigFile();
                        lastAppliedSignature = current.signature;
                        lastRejectedSignature = "";
                        params.logger.info(
                            `baiying-enhance: synchronized Zread default model ${current.fields.llm_model}`,
                        );
                    } catch (error) {
                        const message = redactSecrets(
                            error instanceof Error ? error.message : String(error),
                            [current.fields.llm_api_key],
                        );
                        params.logger.warn(
                            `baiying-enhance: failed to synchronize Zread default model ${current.fields.llm_model}: ${message}`,
                        );
                    }
                }
            } finally {
                workerActive = false;
            }
        })();
    };

    const notify = (
        resolved: ResolvedDefaultBaiyingAimodelProviderBundle,
    ): Promise<void> => {
        if (!params.settings.enabled) {
            return queue;
        }
        let fields: ZreadConfigFields;
        try {
            fields = resolveZreadConfigFields(resolved);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const rejectedSignature = `${resolved.hash}:${message}`;
            if (rejectedSignature !== lastRejectedSignature) {
                lastRejectedSignature = rejectedSignature;
                params.logger.warn(`baiying-enhance: ${message}`);
            }
            return queue;
        }
        const signature = createHash("sha256")
            .update(JSON.stringify(fields))
            .digest("hex");
        if (
            signature === desired?.signature ||
            (signature === lastAppliedSignature && !workerActive)
        ) {
            return queue;
        }
        desired = { fields, signature };
        startWorker();
        return queue;
    };

    return {
        notify,
        waitForIdle: async () => queue,
    };
}
