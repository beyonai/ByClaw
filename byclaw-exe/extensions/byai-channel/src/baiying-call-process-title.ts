const BAIYING_CALL_TOOL_TAG = "(baiying_call)";
const BAIYING_CALL_RESOURCE_MAX_LEN = 48;
const BAIYING_CALL_PURPOSE_MAX_LEN = 48;

const BAIYING_CALL_PROGRESS_PHRASES = {
    zh: {
        doc: [
            "正在检索相关知识",
            "正在查找可参考资料",
            "正在从知识库中寻找答案线索",
            "正在整理知识库中的相关内容",
            "正在核对知识库信息",
        ],
        object: [
            "正在查询业务对象",
            "正在读取业务对象数据",
            "正在获取业务实体信息",
            "正在核对业务对象记录",
            "正在整理业务对象数据",
        ],
        view: [
            "正在分析关联业务数据",
            "正在查询业务视图",
            "正在梳理多表关联关系",
            "正在汇总业务视图数据",
            "正在读取关联视图信息",
        ],
        mcp: [
            "正在调用外部能力",
            "正在连接外部服务",
            "正在请求扩展工具能力",
            "正在获取外部系统结果",
            "正在执行外部能力调用",
        ],
        toolkit: [
            "正在执行业务工具",
            "正在调用工具集能力",
            "正在处理业务工具请求",
            "正在运行指定工具动作",
            "正在获取工具执行结果",
        ],
        tool: [
            "正在调用业务接口",
            "正在请求接口数据",
            "正在处理接口调用",
            "正在获取接口返回结果",
            "正在执行接口能力",
        ],
        agent: [
            "正在请求下游智能体",
            "正在让专业智能体处理",
            "正在转交给相关智能体",
            "正在等待智能体返回结果",
            "正在调用智能体能力",
        ],
        query: [
            "正在查询相关信息",
            "正在分析可用数据",
            "正在查找匹配结果",
            "正在整理查询结果",
            "正在获取相关数据",
        ],
        fallback: [
            "正在处理工具请求",
            "正在调用业务能力",
            "正在获取处理结果",
            "正在执行当前操作",
            "正在推进任务处理",
        ],
    },
    en: {
        doc: [
            "Searching relevant knowledge",
            "Looking up reference material",
            "Finding answer clues in the knowledge base",
            "Reviewing knowledge base content",
            "Checking knowledge base information",
        ],
        object: [
            "Querying business object data",
            "Reading business object records",
            "Fetching business entity information",
            "Checking business object records",
            "Organizing business object data",
        ],
        view: [
            "Analyzing related business data",
            "Querying the business view",
            "Mapping multi-table relationships",
            "Summarizing business view data",
            "Reading related view information",
        ],
        mcp: [
            "Calling an external capability",
            "Connecting to an external service",
            "Requesting an extended tool capability",
            "Fetching results from an external system",
            "Executing an external capability call",
        ],
        toolkit: [
            "Running a business tool",
            "Calling a toolkit capability",
            "Processing the tool request",
            "Running the selected tool action",
            "Fetching the tool execution result",
        ],
        tool: [
            "Calling a business API",
            "Requesting API data",
            "Processing the API call",
            "Fetching the API response",
            "Executing an API capability",
        ],
        agent: [
            "Requesting a downstream agent",
            "Letting a specialist agent handle this",
            "Handing off to the relevant agent",
            "Waiting for the agent response",
            "Calling an agent capability",
        ],
        query: [
            "Querying relevant information",
            "Analyzing available data",
            "Looking for matching results",
            "Organizing query results",
            "Fetching related data",
        ],
        fallback: [
            "Processing the tool request",
            "Calling a business capability",
            "Fetching the result",
            "Executing the current operation",
            "Working on the current task",
        ],
    },
} as const;

type BaiyingCallProgressKind = keyof typeof BAIYING_CALL_PROGRESS_PHRASES.zh;

function isEnglishLanguage(language?: string): boolean {
    const t = typeof language === "string" ? language.trim() : "";
    return t === "en_US" || t.toLowerCase().startsWith("en");
}

function truncateOneLine(s: string, maxLen: number): string {
    const t = s.replace(/\s+/g, " ").trim();
    if (!t) {
        return "";
    }
    if (t.length <= maxLen) {
        return t;
    }
    return `${t.slice(0, Math.max(0, maxLen - 3))}...`;
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.trim().length > 0;
}

/** Tool args may stringify ids as numbers in some runtimes. */
function asTrimmedText(v: unknown): string {
    if (v === undefined || v === null) {
        return "";
    }
    if (typeof v === "string") {
        return v.trim();
    }
    if (typeof v === "number" && Number.isFinite(v)) {
        return String(v);
    }
    return "";
}

function containsCjkText(s: string): boolean {
    return /[\u3400-\u9fff\uf900-\ufaff]/u.test(s);
}

function shouldShowRawBaiyingText(language: string | undefined, text: string): boolean {
    return !isEnglishLanguage(language) || !containsCjkText(text);
}

/** Prefer structured fields from `arguments` when top-level `query` is absent. */
function pickPurposeFromBaiyingArguments(argumentsVal: unknown): string {
    if (!argumentsVal || typeof argumentsVal !== "object" || Array.isArray(argumentsVal)) {
        return "";
    }
    const rec = argumentsVal as Record<string, unknown>;
    for (const key of ["content", "question", "query", "message"] as const) {
        const v = rec[key];
        if (isNonEmptyString(v)) {
            return truncateOneLine(v.trim(), BAIYING_CALL_PURPOSE_MAX_LEN);
        }
    }
    return "";
}

function pickRandomPhrase<T extends readonly string[]>(phrases: T): T[number] {
    return phrases[Math.floor(Math.random() * phrases.length)];
}

function resolveBaiyingCallProgressKind(args: Record<string, any> | undefined): BaiyingCallProgressKind {
    const type = asTrimmedText(args?.resource_type).toUpperCase();
    const action = asTrimmedText(args?.action).toLowerCase();

    if (["KG_DOC", "KG_DB", "KG_QA", "DOC", "ATOM"].includes(type)) {
        return "doc";
    }
    if (type === "OBJECT") {
        return "object";
    }
    if (type === "VIEW") {
        return "view";
    }
    if (type === "MCP") {
        return "mcp";
    }
    if (type === "TOOLKIT") {
        return "toolkit";
    }
    if (type === "TOOL") {
        return "tool";
    }
    if (["AGENT", "A2A", "INTERFACE", "PAGE"].includes(type)) {
        return "agent";
    }
    if (["SEARCH", "QUERY"].includes(type) || action.includes("search") || action.includes("query")) {
        return "query";
    }
    return "fallback";
}

function resolveBaiyingCallProgressText(
    language: string | undefined,
    args: Record<string, any> | undefined,
): string {
    const phraseSet = isEnglishLanguage(language)
        ? BAIYING_CALL_PROGRESS_PHRASES.en
        : BAIYING_CALL_PROGRESS_PHRASES.zh;
    return pickRandomPhrase(phraseSet[resolveBaiyingCallProgressKind(args)]);
}

function resolveBaiyingCallResource(args: Record<string, any> | undefined): string {
    if (!args || typeof args !== "object") {
        return "";
    }
    const resName = asTrimmedText(args.resource_name);
    if (resName) {
        return truncateOneLine(resName, BAIYING_CALL_RESOURCE_MAX_LEN);
    }
    const action = asTrimmedText(args.action);
    if (action) {
        return truncateOneLine(action, BAIYING_CALL_RESOURCE_MAX_LEN);
    }
    return "";
}

function resolveBaiyingCallPurpose(
    language: string | undefined,
    args: Record<string, any> | undefined,
): string {
    if (!args || typeof args !== "object") {
        return "";
    }
    const queryText = asTrimmedText(args.query);
    if (queryText && shouldShowRawBaiyingText(language, queryText)) {
        return truncateOneLine(queryText, BAIYING_CALL_PURPOSE_MAX_LEN);
    }
    const argumentPurpose = pickPurposeFromBaiyingArguments(args.arguments);
    return shouldShowRawBaiyingText(language, argumentPurpose) ? argumentPurpose : "";
}

export function buildBaiyingCallToolStartTitle(
    language: string | undefined,
    args: Record<string, any> | undefined,
): string {
    const en = isEnglishLanguage(language);
    const fallback = en ? "Call tool: baiying_call" : "调用工具: baiying_call";
    if (!args || typeof args !== "object") {
        return fallback;
    }

    const rawResource = resolveBaiyingCallResource(args);
    const resource = shouldShowRawBaiyingText(language, rawResource) ? rawResource : "";
    const purpose = resolveBaiyingCallPurpose(language, args);
    const progressText = resolveBaiyingCallProgressText(language, args);
    if (!resource && !purpose) {
        return `${progressText} ${BAIYING_CALL_TOOL_TAG}`;
    }

    if (resource) {
        return en
            ? `${progressText}: "${resource}" ${BAIYING_CALL_TOOL_TAG}`
            : `${progressText}「${resource}」${BAIYING_CALL_TOOL_TAG}`;
    }
    return en
        ? `${progressText}: ${purpose} ${BAIYING_CALL_TOOL_TAG}`
        : `${progressText}：${purpose}${BAIYING_CALL_TOOL_TAG}`;
}

export function buildBaiyingCallToolResultTitle(
    language: string | undefined,
    params: {
        args?: Record<string, any>;
        isError?: boolean;
    },
): string {
    const en = isEnglishLanguage(language);
    const rawResource = resolveBaiyingCallResource(params.args);
    const resource = shouldShowRawBaiyingText(language, rawResource) ? rawResource : "";
    if (!resource) {
        if (en) {
            return params.isError
                ? `Tool call failed ${BAIYING_CALL_TOOL_TAG}`
                : `Tool call completed ${BAIYING_CALL_TOOL_TAG}`;
        }
        return params.isError
            ? `工具调用失败${BAIYING_CALL_TOOL_TAG}`
            : `工具调用已完成${BAIYING_CALL_TOOL_TAG}`;
    }
    if (en) {
        return params.isError
            ? `Failed: "${resource}" ${BAIYING_CALL_TOOL_TAG}`
            : `Completed: "${resource}" ${BAIYING_CALL_TOOL_TAG}`;
    }
    return params.isError
        ? `「${resource}」调用失败${BAIYING_CALL_TOOL_TAG}`
        : `已完成「${resource}」${BAIYING_CALL_TOOL_TAG}`;
}
