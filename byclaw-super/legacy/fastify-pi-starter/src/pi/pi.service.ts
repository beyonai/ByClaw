import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AppConfig } from "../config.js";
import type { ChatInput, ChatResult, PiClient, StreamEvent } from "./pi.types.js";

export class PiService implements PiClient {
  private modelRuntime?: Awaited<ReturnType<typeof ModelRuntime.create>>;

  constructor(
    private readonly config: Pick<AppConfig, "piProvider" | "piModel" | "openAiBaseUrl">,
  ) {}

  async initialize(): Promise<void> {
    this.modelRuntime = await ModelRuntime.create();
    if (this.config.openAiBaseUrl) {
      this.modelRuntime.registerProvider("zhipu", {
        name: "ZAI",
        baseUrl: this.config.openAiBaseUrl,
        apiKey: "$OPENAI_API_KEY",
        authHeader: true,
        api: "openai-completions",
        models: [
          {
            id: "glm-5.2",
            name: "GLM-5.2",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1_000_000,
            maxTokens: 128_000,
            compat: {
              supportsDeveloperRole: false,
              supportsReasoningEffort: false,
            },
          },
        ],
      });
    }
  }

  isReady(): boolean {
    return this.modelRuntime !== undefined;
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    let text = "";
    let sessionId = "";
    let model = "";

    await this.run(input, (event) => {
      if (event.type === "start") {
        sessionId = event.sessionId;
        model = event.model;
      } else if (event.type === "delta") {
        text += event.text;
      }
    });

    return { sessionId, model, text };
  }

  async stream(input: ChatInput, emit: (event: StreamEvent) => void): Promise<void> {
    await this.run(input, emit);
  }

  private async run(input: ChatInput, emit: (event: StreamEvent) => void): Promise<void> {
    const modelRuntime = this.requireRuntime();
    const model = await this.resolveModel(modelRuntime);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 2 },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      settingsManager,
      systemPromptOverride: () =>
        input.systemPrompt ?? "You are a helpful assistant. Answer clearly and concisely.",
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: process.cwd(),
      model,
      modelRuntime,
      noTools: "all",
      resourceLoader,
      sessionManager: SessionManager.inMemory(process.cwd()),
      settingsManager,
      thinkingLevel: "off",
    });

    emit({ type: "start", sessionId: session.sessionId, model: `${model.provider}/${model.id}` });

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        emit({ type: "delta", text: event.assistantMessageEvent.delta });
      } else if (event.type === "tool_execution_start") {
        emit({ type: "tool_start", toolName: event.toolName });
      } else if (event.type === "tool_execution_end") {
        emit({ type: "tool_end", toolName: event.toolName, isError: event.isError });
      }
    });

    try {
      await session.prompt(input.message);
      emit({ type: "done" });
    } finally {
      unsubscribe();
      session.dispose();
    }
  }

  private requireRuntime(): Awaited<ReturnType<typeof ModelRuntime.create>> {
    if (!this.modelRuntime) {
      throw new Error("Pi SDK has not been initialized");
    }
    return this.modelRuntime;
  }

  private async resolveModel(runtime: Awaited<ReturnType<typeof ModelRuntime.create>>) {
    const { piProvider, piModel } = this.config;
    if ((piProvider && !piModel) || (!piProvider && piModel)) {
      throw new Error("PI_PROVIDER and PI_MODEL must be configured together");
    }

    if (piProvider && piModel) {
      const configured = runtime.getModel(piProvider, piModel);
      if (!configured) {
        throw new Error(`Pi model not found: ${piProvider}/${piModel}`);
      }
      return configured;
    }

    const [available] = await runtime.getAvailable();
    if (!available) {
      throw new Error(
        "No authenticated Pi model is available. Set a provider API key and optionally PI_PROVIDER/PI_MODEL.",
      );
    }
    return available;
  }
}
