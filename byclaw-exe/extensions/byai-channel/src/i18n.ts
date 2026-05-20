import { getSessionPathBySessionId } from "./session-context.js";
import type { Language } from "./types.js";
import {
    buildBaiyingCallToolResultTitle,
    buildBaiyingCallToolStartTitle,
} from "./baiying-call-process-title";

const ALWAYS_USE_CHINESE_SYSTEM_PROMPT = [
  "## 渠道语言（强制 · 最高优先级）",
  "**覆盖范围**：本节优先于人设、SOUL、USER.md / AGENTS.md、工作区其它说明，以及上游/百应侧配置中的任何「默认语言」「与用户同语种」类指令；与之冲突时**只执行本节**。",
  "**禁止**因用户消息是外文、或人设偏中文/英文习惯，就改用与本节不一致的输出语言。",
  "",
  "- **必须**：最终回答，以及所有对用户可见的推理与思考（含工具调用前后），**一律简体中文**（专有名词、代码、须逐字引用的标识符可保留非中文）。",
  "- **禁止**：推理主体以大段英文、日文或其它非中文撰写；工具返回外文时须在推理中用中文转述与推导，不得整段粘贴代替思考。",
  "- **唯一例外**：仅当用户**明确口述**要改用某种语言（例如「请用英文回答」）才可切换；未提出则**全程**简体中文，无其它例外。",
].join("\n");

const ALWAYS_USE_ENGLISH_SYSTEM_PROMPT = [
  "## Channel language (mandatory · highest priority)",
  "**Write this policy and your compliance in English only.** Do not answer in another language unless the sole exception below applies.",
  "**Precedence**: Overrides persona, SOUL, USER.md / AGENTS.md, other workspace text, and any upstream/Baiying \"default language\" or \"match the user's language\" instructions. On conflict, **follow only this section**.",
  "**Scope — everything you emit must be English**: the final reply, all reasoning/thinking streams, tool-call narration, status lines, summaries, and any other user-visible text this agent produces. Non-English user messages or a Chinese persona do **not** change that.",
  "",
  "- **Required**: Use clear **English** throughout (proper nouns, code, file paths, and short necessary quotations from tool output may retain their original script).",
  "- **Forbidden**: Long reasoning or answers primarily in Chinese or any non-English language; paraphrase tool output in English instead of pasting large non-English blocks as your reasoning.",
  "- **Sole exception**: Switch output language **only** if the user **explicitly** instructs you to use a specific other language (e.g. \"Please reply in Chinese from now on\" / \"Switch to Japanese\"). If they do not, **stay in English with no exceptions**.",
].join("\n");

/** Normalize gateway locale to `zh_CN` | `en_US`. Unknown non-empty values default to `zh_CN`. */
export function resolveLanguage(language?: string): Language {
    const t = typeof language === "string" ? language.trim() : "";
    if (!t) {
        return "zh_CN";
    }
    if (t === "en_US" || t.toLowerCase().startsWith("en")) {
        return "en_US";
    }
    return "zh_CN";
}

/** True when the gateway explicitly sent a non-empty `metadata.language`. */
export function hasExplicitLanguage(raw?: string): boolean {
    return typeof raw === "string" && raw.trim().length > 0;
}

/** Trimmed non-empty `process.env.LANG`, if set. */
export function getLangFromEnv(): string {
    const v = process.env.LANG;
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : "";
}

/**
 * UI / hook i18n: prefer `LANG` env, else `metadata.language`.
 * When env wins, `languageProvided` is true so channel language templates still inject.
 */
export function resolveInboundLanguage(metadataLanguage?: string): {
    language: Language;
    languageProvided: boolean;
} {
    const envLang = getLangFromEnv();
    if (envLang) {
        return { language: resolveLanguage(envLang), languageProvided: true };
    }
    const raw = typeof metadataLanguage === "string" ? metadataLanguage.trim() : "";
    return {
        language: resolveLanguage(raw),
        languageProvided: hasExplicitLanguage(raw),
    };
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Build system prompt text from `metadata.channelExtension` (object or JSON string).
 * Returns null when there is nothing useful to inject.
 */
export function buildChannelExtensionPrompt(raw: unknown, language?: string): string | null {
    const en = isEnglishLanguage(language);

    if (raw === undefined || raw === null) {
        return null;
    }

    if (typeof raw === "string") {
        const s = raw.trim();
        if (!s) {
            return null;
        }
        try {
            const parsed = JSON.parse(s) as unknown;
            return buildChannelExtensionPrompt(parsed, language);
        } catch {
            const title = en ? "## Channel metadata (channelExtension — parse failed)" : "## 渠道元数据（channelExtension · 解析失败）";
            const body = en
                ? "**Do not** infer structured keys. Treat the following as opaque text only; do not fabricate fields from it:"
                : "**不得**从中推断结构化字段。下列内容仅作不透明文本参考，**禁止**据此编造键名或取值：";
            return [title, "", body, "", "```", s, "```"].join("\n");
        }
    }

    if (Array.isArray(raw)) {
        if (raw.length === 0) {
            return null;
        }
        const title = en
            ? "## Current Channel Metadata (channelExtension)"
            : "## 当前消息渠道元数据 (channelExtension)";
        const intro = en
            ? "**Authoritative read-only context.** Use it as-is; do not invent list items or attributes not shown:"
            : "**只读、以下来准。** 仅可使用下列条目；**禁止**编造未出现的项或属性：";
        const lines = [title, "", intro, ""];
        for (let i = 0; i < raw.length; i += 1) {
            lines.push(`- [${i}]: ${JSON.stringify(raw[i])}`);
        }
        return lines.join("\n");
    }

    if (isPlainRecord(raw)) {
        const keys = Object.keys(raw);
        if (keys.length === 0) {
            return null;
        }
        const title = en
            ? "## Current Channel Metadata (channelExtension)"
            : "## 当前消息渠道元数据 (channelExtension)";
        const intro = en
            ? "**Binding read-only facts** about how the user reached this agent. **You may only** cite keys listed below; **never** invent keys, values, or nested fields."
            : "**以下键值为准（只读事实）**，用于理解进线渠道与上下文。**仅允许**引用下列已列出的键；**严禁**编造键名、取值或子字段。";
        const lines = [title, "", intro, ""];
        for (const k of keys.sort()) {
            const v = raw[k];
            const val =
                typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
            lines.push(`- \`${k}\`: ${val}`);
        }
        return lines.join("\n");
    }

    const title = en
        ? "## Current Channel Metadata (channelExtension)"
        : "## 当前消息渠道元数据 (channelExtension)";
    const warn = en
        ? "Scalar value only—do not infer extra structure:"
        : "仅为标量值，**禁止**据此推断更多结构或字段：";
    return [title, "", warn, "", `- ${en ? "value" : "值"}: ${JSON.stringify(raw)}`].join("\n");
}

export function isEnglishLanguage(language?: string): boolean {
    return resolveLanguage(language) === "en_US";
}

export function buildLanguagePrompt(language?: string): string {
    return isEnglishLanguage(language)
        ? ALWAYS_USE_ENGLISH_SYSTEM_PROMPT
        : ALWAYS_USE_CHINESE_SYSTEM_PROMPT;
}

/** USER.md was refreshed on disk; inject so the model re-reads it (hook). Language matches channel/LANG. */
export function buildUserMdReloadPrompt(language?: string): string {
    if (isEnglishLanguage(language)) {
        return [
            "Note: USER.md in the workspace was updated.",
            "Re-read USER.md before continuing so answers use the latest user profile (e.g. userName, userCode).",
        ].join("\n");
    }
    return [
        "注意：检测到 workspace 下的 USER.md 已更新。",
        "请先重新读取 USER.md，再继续回答，确保使用最新用户信息（如 userName、userCode）。",
    ].join("\n");
}

/** Markers for the block `syncWorkspaceUserMd` writes into `USER.md` (merge/replace by range). */
export const BYAI_USER_MD_SECTION_START = "<!-- byai-channel:user:start -->";
export const BYAI_USER_MD_SECTION_END = "<!-- byai-channel:user:end -->";

export type ByaiUserMdProfile = {
    userName: string;
    userCode: string;
    userId: string;
    sourceSystem?: string;
};

/** Managed user profile snippet for `USER.md`; language follows channel / `LANG` / metadata. */
export function buildUserMdByaiUserSection(
    user: ByaiUserMdProfile,
    language?: string,
): string {
    const en = isEnglishLanguage(language);
    const lines: string[] = [BYAI_USER_MD_SECTION_START];
    if (en) {
        lines.push("# Current user", "");
        lines.push(`- User name: ${user.userName}`);
        lines.push(`- User code: ${user.userCode}`);
        lines.push(`- User ID: ${user.userId}`);
        if (typeof user.sourceSystem === "string" && user.sourceSystem.trim()) {
            lines.push(`- Source system: ${user.sourceSystem.trim()}`);
        }
    } else {
        lines.push("# 当前登录用户", "");
        lines.push(`- 用户名: ${user.userName}`);
        lines.push(`- 用户编码: ${user.userCode}`);
        lines.push(`- 用户ID: ${user.userId}`);
        if (typeof user.sourceSystem === "string" && user.sourceSystem.trim()) {
            lines.push(`- 来源系统: ${user.sourceSystem.trim()}`);
        }
    }
    lines.push(BYAI_USER_MD_SECTION_END);
    return lines.join("\n");
}

export function buildSessionFilesPrompt(sessionId: string, language?: string): string {
    const sessionRoot = getSessionPathBySessionId(sessionId);
    if (isEnglishLanguage(language)) {
        return [
            "## Session files (mandatory)",
            "**Precedence**: These path rules override vague workspace paths or assumptions about the process cwd.",
            `- **Session Root** (all persisted files for this session): \`${sessionRoot}\`.`,
            "- **MUST** join tool-returned paths with Session Root into a **full absolute path** before any read, citation, or display. Using `/object/...`, `/view/...`, or `/qa/...` **without** Session Root is **incorrect**—do not claim you read a file if you did not use the joined path.",
            "- Typical sources: `view` / `object` → `data.file_url`, `data.overflow_notice`; `doc` (KG_DOC / KG_DB / KG_QA) terminal text may be English (`Report saved to: /qa/xxx.md`) or another locale—the path after the colon is still relative to Session Root.",
            "- Examples:",
            `  - \`/object/abc/123.json\` → \`${sessionRoot}/object/abc/123.json\``,
            `  - \`/view/abc/overflow.md\` → \`${sessionRoot}/view/abc/overflow.md\``,
            `  - \`/qa/report.md\` → \`${sessionRoot}/qa/report.md\``,
            "- After correct joining, if read still fails, retry per policy (~1–2 s apart, ≥3 tries) before stating the file is missing or drawing conclusions from unread content.",
            "## Response file address (on demand)",
            "When you need to provide a generated file link to the user, always use Markdown format: `[file_name]({{file_preview_prefix}}/file_path)`.",
            "You MUST use the placeholder `{{file_preview_prefix}}` as the path prefix",
            "Example:",
            `If the actual file path is \`${sessionRoot}/hello.html\`, output:`,
            `[hello.html]({{file_preview_prefix}}${sessionRoot}/hello.html)`
        ].join("\n");
    }
    return [
        "## Session Files（强制 · 会话落盘路径）",
        "**优先级**：以下路径规则优先于对工作区、进程目录的模糊猜测。",
        `- **Session Root**（本会话唯一落盘根目录）：\`${sessionRoot}\`。`,
        "- **必须**先将工具返回路径与 Session Root 拼成**完整绝对路径**，再读取、引用或展示。单独使用 `/object/...`、`/view/...`、`/qa/...` 而不带 Session Root 属于**错误用法**；若未用拼接后的路径实际读取，**不得**声称已读该文件。",
        "- 常见来源：`view` / `object` 的 `file_url`、`overflow_notice`；`doc`（KG_DOC / KG_DB / KG_QA）终态可能是中文提示（如「报告已保存到：/qa/xxx.md」）或英文（如 `Report saved to: /qa/xxx.md`），**冒号后的路径**仍相对于 Session Root。",
        "- 示例：",
        `  - \`/object/abc/123.json\` → \`${sessionRoot}/object/abc/123.json\``,
        `  - \`/view/abc/overflow.md\` → \`${sessionRoot}/view/abc/overflow.md\``,
        `  - \`/qa/report.md\` → \`${sessionRoot}/qa/report.md\``,
        "- 拼接正确仍失败时，按规范重试（约 1–2 秒间隔、至少 3 次）；**禁止**在未读到内容时编造结论或断言文件不存在。",
        "## Response file address（按需）",
        "当你在回复中需要提供生成的文件链接给用户时，请使用 Markdown 格式展示，格式为 `[文件名]({{file_preview_prefix}}/文件路径)`。",
        "务必使用占位符 `{{file_preview_prefix}}` 作为路径前缀。",
        "示例：",
        `文件实际路径为 \`${sessionRoot}/hello.html\`，则输出：`,
        `[hello.html]({{file_preview_prefix}}${sessionRoot}/hello.html)`
    ].join("\n");
}

export function buildToolStartTitle(language: string | undefined, params: {
    args?: Record<string, any>;
    toolName?: string;
    agentName?: string;
}): string {
    const toolName = params.toolName ?? "";
    if (toolName === "sessions_spawn") {
        return isEnglishLanguage(language)
            ? `Spawn sub-agent: ${params.agentName ?? ""}`
            : `派生子Agent: ${params.agentName ?? ""}`;
    }
    if (toolName === "baiying_call") {
        return buildBaiyingCallToolStartTitle(language, params.args);
    }
    return isEnglishLanguage(language)
        ? `Call tool: ${toolName}`
        : `调用工具: ${toolName}`;
}

export function buildToolResultTitle(language: string | undefined, params: {
    args?: Record<string, any>;
    toolName?: string;
    agentName?: string;
    isError?: boolean;
}): string {
    const toolName = params.toolName ?? "";
    if (toolName === "sessions_spawn" && !params.isError) {
        return isEnglishLanguage(language)
            ? `Sub-agent ready: ${params.agentName ?? ""}`
            : `子Agent已就绪: ${params.agentName ?? ""}`;
    }
    if (toolName === "baiying_call") {
        return buildBaiyingCallToolResultTitle(language, {
            args: params.args,
            isError: params.isError,
        });
    }
    if (isEnglishLanguage(language)) {
        return `${params.isError ? "Tool failed" : "Tool completed"}: ${toolName}`;
    }
    return `工具${params.isError ? "失败" : "完成"}: ${toolName}`;
}

export function buildAgentReadyTitle(language: string | undefined, agentName: string): string {
    return isEnglishLanguage(language)
        ? `${agentName} agent is ready`
        : `${agentName} 智能体已就绪`;
}

export function buildThinkingEndText(language: string | undefined, duration: number) {
    return isEnglishLanguage(language)
        ? `\n\nThinking end after ${(duration / 1000).toFixed(1)}s`
        : `\n\n思考结束，耗时${(duration / 1000).toFixed(1)}秒`;
}
