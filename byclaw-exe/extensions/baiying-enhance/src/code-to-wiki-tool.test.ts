import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { AgentRegistryState } from "./agent-state.js";
import {
  buildGitCloneEnvironment,
  createCodeToWikiToolFactory,
  parseGitRepositoryUrl,
  resolveRepoWikiModelRuntime,
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

describe("parseGitRepositoryUrl", () => {
  it("normalizes a credential-free GitHub URL", () => {
    expect(parseGitRepositoryUrl("https://github.com/openai/codex")).toEqual({
      canonicalUrl: "https://github.com/openai/codex.git",
      host: "github.com",
      namespace: "openai",
      name: "codex",
    });
  });

  it("accepts non-GitHub hosts, custom ports, and nested namespaces", () => {
    expect(parseGitRepositoryUrl("https://git.example.com:8443/acme/platform/wiki.git")).toEqual({
      canonicalUrl: "https://git.example.com:8443/acme/platform/wiki.git",
      host: "git.example.com:8443",
      namespace: "acme/platform",
      name: "wiki",
    });
  });

  it.each([
    "file:///etc/passwd",
    "ssh://git@github.com/openai/codex.git",
    "https://token@github.com/openai/codex.git",
    "http://git.example.com/openai/codex.git",
    "https://git.example.com/",
    "https://git.example.com/openai/codex.git?ref=main",
  ])("rejects unsafe URL %s", (repositoryUrl) => {
    expect(() => parseGitRepositoryUrl(repositoryUrl)).toThrow();
  });
});

describe("Git and model credentials", () => {
  it("injects GitHub credentials through process env, not the repository URL", () => {
    const repository = parseGitRepositoryUrl("https://github.com/openai/codex");
    const result = buildGitCloneEnvironment(repository, { gitHubToken: "github-secret" });
    expect(result.env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(result.env.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /);
    expect(JSON.stringify(result.env)).not.toContain("github-secret");
    expect(result.sensitiveValues).toContain("github-secret");
  });

  it("does not send a GitHub token to another Git host", () => {
    const repository = parseGitRepositoryUrl("https://gitlab.com/openai/codex.git");
    const result = buildGitCloneEnvironment(repository, { gitHubToken: "github-secret" });
    expect(result.env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(result.sensitiveValues).toEqual([]);

    const nonDefaultPort = parseGitRepositoryUrl("https://github.com:8443/openai/codex.git");
    expect(
      buildGitCloneEnvironment(nonDefaultPort, { gitHubToken: "github-secret" }).env
        .GIT_CONFIG_COUNT,
    ).toBeUndefined();
  });

  it("injects a generic credential only when GIT_HOST exactly matches the target host", () => {
    const repository = parseGitRepositoryUrl(
      "https://git.example.com:8443/acme/platform/wiki.git",
    );
    const credentials = {
      privateHost: "git.example.com:8443",
      privateUsername: "git-user",
      privateToken: "git-secret",
    };
    const result = buildGitCloneEnvironment(repository, credentials);
    expect(result.env.GIT_CONFIG_KEY_0).toBe(
      "http.https://git.example.com:8443/.extraheader",
    );
    expect(result.env.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /);
    expect(JSON.stringify(result.env)).not.toContain("git-secret");
    expect(result.sensitiveValues).toContain("git-secret");

    const otherRepository = parseGitRepositoryUrl("https://other.example.com/acme/wiki.git");
    expect(
      buildGitCloneEnvironment(otherRepository, credentials).env.GIT_CONFIG_COUNT,
    ).toBeUndefined();
  });

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

describe("code_to_wiki tool factory", () => {
  it("only exposes the tool to a registered managed digital employee", () => {
    const registry = new AgentRegistryState();
    const factory = createCodeToWikiToolFactory({
      registry,
      loadGitCredentials: async () => ({}),
      resolveWorkspaceDir: () => "/tmp/unused",
    });
    expect(factory({ agentId: "main" })).toBeNull();
    expect(factory({ agentId: "baiying-agent-missing" })).toBeNull();
  });

  it("shallow-clones privately and runs RepoWiki with the agent model", async () => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const workspace = await fs.mkdtemp(path.join(tmpdir(), "code-to-wiki-test-"));
    cleanupPaths.push(workspace);
    const requests: ProcessRunRequest[] = [];
    const runProcess = async (request: ProcessRunRequest): Promise<ProcessRunResult> => {
      requests.push(request);
      if (request.command === "repowiki-test") {
        const outputIndex = request.args.indexOf("--output");
        const outputDir = request.args[outputIndex + 1];
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(path.join(outputDir, "README.md"), "# Generated Wiki\n", "utf8");
      } else {
        await fs.mkdir(path.join(request.cwd ?? "", "repository"), { recursive: true });
        await fs.writeFile(path.join(request.cwd ?? "", "repository", "README.md"), "source", "utf8");
      }
      return processResult();
    };
    const factory = createCodeToWikiToolFactory({
      registry,
      loadGitCredentials: async () => ({ gitHubToken: "github-secret" }),
      resolveWorkspaceDir: () => workspace,
      getModelApiKey: () => "model-secret",
      runProcess,
      randomId: () => "job-1",
      now: () => new Date("2026-08-24T01:02:03.000Z"),
      settings: {
        gitCommand: "git-test",
        repoWikiCommand: "repowiki-test",
      },
    });
    const tool = factory({ agentId: "baiying-agent-1001" });
    const result = await tool.execute("call-1", {
      repository_url: "https://github.com/acme/private-repo",
      branch: "develop",
      language: "zh",
      output_format: "markdown",
    });

    expect(result.details.ok).toBe(true);
    expect(result.details.output.files).toEqual([{ path: "README.md", size: 17 }]);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.args).toEqual([
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      "develop",
      "--",
      "https://github.com/acme/private-repo.git",
      "repository",
    ]);
    expect(requests[0]?.args.join(" ")).not.toContain("github-secret");
    expect(requests[1]?.env).toMatchObject({
      REPOWIKI_API_BASE: "https://llm.example.test/v1",
      REPOWIKI_API_KEY: "model-secret",
      REPOWIKI_LANG: "zh",
      REPOWIKI_MODEL: "openai/deepseek-chat",
    });
    expect(JSON.stringify(result)).not.toContain("github-secret");
    expect(JSON.stringify(result)).not.toContain("model-secret");
  });

  it("rejects RepoWiki output when the wrapped LLM failed", async () => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const workspace = await fs.mkdtemp(path.join(tmpdir(), "code-to-wiki-test-"));
    cleanupPaths.push(workspace);
    let invocation = 0;
    const factory = createCodeToWikiToolFactory({
      registry,
      loadGitCredentials: async () => ({}),
      resolveWorkspaceDir: () => workspace,
      getModelApiKey: () => "model-secret",
      runProcess: async (request) => {
        invocation += 1;
        if (invocation === 1) {
          await fs.mkdir(path.join(request.cwd ?? "", "repository"), { recursive: true });
          return processResult();
        }
        return processResult({ stdout: "[LLM Error: unauthorized]" });
      },
    });
    const tool = factory({ agentId: "baiying-agent-1001" });
    const result = await tool.execute("call-2", {
      repository_url: "https://gitlab.com/acme/platform/repo.git",
    });

    expect(result.details).toEqual({
      ok: false,
      error: {
        code: "REPOWIKI_LLM_FAILED",
        message: "RepoWiki reported an LLM failure and did not produce trustworthy documentation.",
      },
    });
  });
});
