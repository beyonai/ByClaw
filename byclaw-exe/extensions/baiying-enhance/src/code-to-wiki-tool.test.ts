import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { AgentRegistryState } from "./agent-state.js";
import {
  createCodeToWikiToolFactory,
  resolveRepoWikiModelRuntime,
  runCodeToWikiProcess,
  type ProcessOutputLine,
  type ProcessRunRequest,
  type ProcessRunResult,
} from "./code-to-wiki-tool.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })),
  );
});

function managedAgent(): AdaptedManagedAgent {
  return {
    sourceKey: "1001",
    agentId: "baiying-agent-1001",
    providerKey: "baiying-m-99",
    modelRef: "baiying-m-99/deepseek-chat",
    allowSpawnFrom: ["main"],
    listEntry: { id: "baiying-agent-1001" },
    baiyingModelId: "99",
    provider: {
      api: "openai-completions",
      apiKey: {
        source: "exec",
        provider: "baiying-aimodel-redis",
        id: "model:99",
      },
      baseUrl: "https://llm.example.test/v1",
      modelId: "deepseek-chat",
    },
  };
}

function processResult(overrides: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    ok: true,
    exitCode: 0,
    signal: null,
    durationMs: 10,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    aborted: false,
    truncated: false,
    ...overrides,
  };
}

async function createWorkspaceWithRepository(): Promise<{
  workspace: string;
  repository: string;
}> {
  const createdWorkspace = await fs.mkdtemp(path.join(tmpdir(), "code-to-wiki-test-"));
  cleanupPaths.push(createdWorkspace);
  const workspace = await fs.realpath(createdWorkspace);
  const repository = path.join(workspace, "repos", "private-repo");
  await fs.mkdir(repository, { recursive: true });
  await fs.writeFile(path.join(repository, "README.md"), "# Source\n", "utf8");
  return { workspace, repository };
}

describe("RepoWiki model runtime", () => {
  it("maps the Redis-backed OpenAI-compatible model for LiteLLM", () => {
    expect(resolveRepoWikiModelRuntime(managedAgent(), () => "model-secret")).toEqual({
      apiBase: "https://llm.example.test/v1",
      apiKey: "model-secret",
      model: "openai/deepseek-chat",
      modelRef: "baiying-m-99/deepseek-chat",
    });
  });

  it("maps the Redis-backed Anthropic model for LiteLLM", () => {
    const agent = managedAgent();
    agent.provider = {
      ...agent.provider!,
      api: "anthropic-messages",
      modelId: "claude-sonnet-4-6",
    };
    expect(resolveRepoWikiModelRuntime(agent, () => "model-secret").model).toBe(
      "anthropic/claude-sonnet-4-6",
    );
  });
});

describe("runCodeToWikiProcess", () => {
  it("streams redacted stdout and stderr lines", async () => {
    const progress: ProcessOutputLine[] = [];
    const result = await runCodeToWikiProcess({
      command: process.execPath,
      args: [
        "-e",
        'process.stdout.write("Scanning 1/2\\n"); process.stderr.write("token=model-secret\\n");',
      ],
      env: { ...process.env },
      timeoutMs: 5000,
      maxOutputBytes: 16 * 1024,
      sensitiveValues: ["model-secret"],
      onOutputLine: (output) => progress.push(output),
    });

    expect(result.ok).toBe(true);
    expect(progress).toContainEqual({ stream: "stdout", line: "Scanning 1/2" });
    expect(progress).toContainEqual({ stream: "stderr", line: "token=***" });
  });
});

describe("code_to_wiki tool factory", () => {
  it("only exposes the tool to a registered managed digital employee", () => {
    const registry = new AgentRegistryState();
    const factory = createCodeToWikiToolFactory({
      registry,
      resolveWorkspaceDir: () => "/tmp/unused",
    });
    expect(factory({ agentId: "main" })).toBeNull();
    expect(factory({ agentId: "baiying-agent-missing" })).toBeNull();
  });

  it("runs RepoWiki once against an existing repository and streams progress", async () => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const { workspace, repository } = await createWorkspaceWithRepository();
    const requests: ProcessRunRequest[] = [];
    const updates: Array<Record<string, any>> = [];
    const runProcess = async (request: ProcessRunRequest): Promise<ProcessRunResult> => {
      requests.push(request);
      request.onOutputLine?.({ stream: "stdout", line: "Scanning source files 1/2" });
      const outputIndex = request.args.indexOf("--output");
      const outputDir = request.args[outputIndex + 1];
      await fs.writeFile(path.join(outputDir, "README.md"), "# Generated Wiki\n", "utf8");
      return processResult();
    };
    const factory = createCodeToWikiToolFactory({
      registry,
      resolveWorkspaceDir: () => workspace,
      getModelApiKey: () => "model-secret",
      runProcess,
      settings: {
        repoWikiCommand: "repowiki-test",
      },
    });
    const tool = factory({ agentId: "baiying-agent-1001" });
    const result = await tool.execute(
      "call-1",
      {
        repository_path: "repos/private-repo",
        output_directory: "wiki/private-repo",
        language: "zh",
        output_format: "markdown",
      },
      undefined,
      (update: Record<string, any>) => updates.push(update),
    );

    expect(result.details.ok).toBe(true);
    expect(result.details.repository).toEqual({ path: repository });
    expect(result.details.output.files).toEqual([{ path: "README.md", size: 17 }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.command).toBe("repowiki-test");
    expect(requests[0]?.args).toEqual([
      "scan",
      repository,
      "--output",
      path.join(workspace, "wiki", "private-repo"),
      "--format",
      "markdown",
      "--lang",
      "zh",
    ]);
    expect(requests[0]?.env).toMatchObject({
      REPOWIKI_API_BASE: "https://llm.example.test/v1",
      REPOWIKI_API_KEY: "model-secret",
      REPOWIKI_LANG: "zh",
      REPOWIKI_MODEL: "openai/deepseek-chat",
    });
    expect(updates.some((update) => update.details?.status === "preparing")).toBe(true);
    expect(
      updates.some((update) => update.details?.message === "Scanning source files 1/2"),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("model-secret");
  });

  it("rejects repository paths outside the digital employee workspace", async () => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const { workspace } = await createWorkspaceWithRepository();
    const outsideRepository = await fs.mkdtemp(path.join(tmpdir(), "code-to-wiki-outside-"));
    cleanupPaths.push(outsideRepository);
    const factory = createCodeToWikiToolFactory({
      registry,
      resolveWorkspaceDir: () => workspace,
      getModelApiKey: () => "model-secret",
    });
    const tool = factory({ agentId: "baiying-agent-1001" });
    const result = await tool.execute("call-2", {
      repository_path: outsideRepository,
      output_directory: "wiki/private-repo",
    });

    expect(result.details.error.code).toBe("PATH_OUTSIDE_WORKSPACE");
  });

  it("preserves an existing output directory when RepoWiki reports an LLM failure", async () => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const { workspace } = await createWorkspaceWithRepository();
    const outputDirectory = path.join(workspace, "wiki", "private-repo");
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(path.join(outputDirectory, "existing.md"), "keep", "utf8");
    const factory = createCodeToWikiToolFactory({
      registry,
      resolveWorkspaceDir: () => workspace,
      getModelApiKey: () => "model-secret",
      runProcess: async () => processResult({ stdout: "[LLM Error: unauthorized]" }),
    });
    const tool = factory({ agentId: "baiying-agent-1001" });
    const result = await tool.execute("call-3", {
      repository_path: "repos/private-repo",
      output_directory: "wiki/private-repo",
    });

    expect(result.details).toEqual({
      ok: false,
      error: {
        code: "REPOWIKI_LLM_FAILED",
        message: "RepoWiki reported an LLM failure and did not produce trustworthy documentation.",
      },
    });
    await expect(fs.readFile(path.join(outputDirectory, "existing.md"), "utf8")).resolves.toBe(
      "keep",
    );
  });
});
