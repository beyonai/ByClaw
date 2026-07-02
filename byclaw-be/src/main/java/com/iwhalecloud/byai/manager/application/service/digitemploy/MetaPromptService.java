package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import com.iwhalecloud.byai.manager.dto.digitemploy.MetaPromptGenerateRequest;
import com.iwhalecloud.byai.manager.dto.digitemploy.MetaPromptGenerateResult;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Collectors;

@Service
public class MetaPromptService {

    private static final Logger log = LoggerFactory.getLogger(MetaPromptService.class);

    private static final int MAX_LLM_CONCURRENCY = 6;
    private static final Semaphore LLM_SEMAPHORE = new Semaphore(MAX_LLM_CONCURRENCY);

    private static final int MAX_CONTEXT_RESOURCES = 50;
    private static final int LLM_ALL_FIELDS_MAX_TOKENS = 8000;

    private static final List<String> RESOURCE_BIZ_TYPES = List.of(
        "TOOLKIT", "MCP", "KG_DOC", "KG_QA", "AGENT", "OBJECT", "VIEW"
    );

    @Autowired
    private ResourceAuthApplicationService resourceAuthApplicationService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private AIService aiService;

    public MetaPromptGenerateResult generateV3(MetaPromptGenerateRequest request) {
        String lang = request.resolvedLang();
        String description = request.resolvedDescription();
        String modelCode = request.getModelCode();

        List<ResourceAuthVo> resources = gatherResources();
        String bundledSkills = gatherBundledSkills();
        String contextBlock = buildContextBlock(resources, bundledSkills, lang);

        boolean isChinese = "zh".equals(lang);
        String systemPrompt = isChinese ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;

        List<FieldSpec> specs = buildFieldSpecs(isChinese);

        Map<String, Object> generatedFields = generateAllFields(systemPrompt,
            buildAllFieldsUserPrompt(description, contextBlock, specs, isChinese), modelCode, isChinese);
        Map<String, Object> fields = new LinkedHashMap<>();
        for (FieldSpec spec : specs) {
            fields.put(spec.fieldCode, stringifyFieldValue(generatedFields.get(spec.fieldCode)));
        }

        MetaPromptGenerateResult result = new MetaPromptGenerateResult();
        result.setFields(fields);
        result.setContextSummary(buildContextSummary(resources, bundledSkills));
        return result;
    }

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    public void generateV3Stream(MetaPromptGenerateRequest request, OutputStream outputStream) throws IOException {
        String lang = request.resolvedLang();
        String description = request.resolvedDescription();
        String modelCode = request.getModelCode();

        List<ResourceAuthVo> resources = gatherResources();
        String bundledSkills = gatherBundledSkills();
        String contextBlock = buildContextBlock(resources, bundledSkills, lang);

        boolean isChinese = "zh".equals(lang);
        String systemPrompt = isChinese ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
        List<FieldSpec> specs = buildFieldSpecs(isChinese);

        Map<String, Object> startPayload = Map.of("contextSummary", buildContextSummary(resources, bundledSkills));
        writeSseEvent(outputStream, "start", OBJECT_MAPPER.writeValueAsString(startPayload));

        streamGeneratedFields(description, contextBlock, specs, systemPrompt, modelCode, isChinese, outputStream);

        writeSseEvent(outputStream, "done", "[DONE]");
    }

    private void writeSseEvent(OutputStream outputStream, String event, String data) throws IOException {
        outputStream.write(("event: " + event + "\n").getBytes(StandardCharsets.UTF_8));
        outputStream.write(("data: " + data + "\n\n").getBytes(StandardCharsets.UTF_8));
        outputStream.flush();
    }

    private Map<String, Object> generateAllFields(String systemPrompt, String userPrompt, String modelCode,
        boolean isChinese) {
        long startTime = System.currentTimeMillis();
        boolean acquired = false;
        try {
            LLM_SEMAPHORE.acquire();
            acquired = true;
            String content = aiService.generateText(systemPrompt, userPrompt, modelCode, LLM_ALL_FIELDS_MAX_TOKENS);
            Map<String, Object> fields = parseOrRepairGeneratedFields(content, modelCode, isChinese);
            log.info("Meta prompt stream generated all fields in {} ms", System.currentTimeMillis() - startTime);
            return fields;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("Meta prompt stream interrupted while generating all fields", e);
        } catch (Exception e) {
            log.warn("Failed to generate all meta prompt fields", e);
        } finally {
            if (acquired) {
                LLM_SEMAPHORE.release();
            }
        }
        return Collections.emptyMap();
    }

    private void streamGeneratedFields(String description, String contextBlock, List<FieldSpec> specs,
        String systemPrompt, String modelCode, boolean isChinese, OutputStream outputStream) throws IOException {
        long startTime = System.currentTimeMillis();
        boolean acquired = false;
        try {
            LLM_SEMAPHORE.acquire();
            acquired = true;
            String userPrompt = buildAllFieldsUserPrompt(description, contextBlock, specs, isChinese);
            String content = aiService.generateTextStream(systemPrompt, userPrompt, modelCode, LLM_ALL_FIELDS_MAX_TOKENS,
                chunk -> writeSseEvent(outputStream, "textDelta",
                    OBJECT_MAPPER.writeValueAsString(Map.of("value", chunk))));
            Map<String, Object> generatedFields = parseOrRepairGeneratedFields(content, modelCode, isChinese);
            Map<String, Object> fields = new LinkedHashMap<>();
            for (FieldSpec spec : specs) {
                fields.put(spec.fieldCode, stringifyFieldValue(generatedFields.get(spec.fieldCode)));
            }
            writeSseEvent(outputStream, "finalFields", OBJECT_MAPPER.writeValueAsString(fields));
            for (FieldSpec spec : specs) {
                Map<String, String> payload = Map.of(
                    "field", spec.fieldCode,
                    "value", stringifyFieldValue(fields.get(spec.fieldCode))
                );
                writeSseEvent(outputStream, "fieldDelta", OBJECT_MAPPER.writeValueAsString(payload));
            }
            log.info("Meta prompt streamed all fields in {} ms", System.currentTimeMillis() - startTime);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Meta prompt stream interrupted", e);
        } catch (Exception e) {
            log.warn("Failed to stream meta prompt fields", e);
            writeSseEvent(outputStream, "error",
                OBJECT_MAPPER.writeValueAsString(Map.of("message", isChinese ? "生成失败，请重试" : "Generation failed, please retry")));
            throw new IOException("Failed to stream meta prompt fields", e);
        } finally {
            if (acquired) {
                LLM_SEMAPHORE.release();
            }
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseOrRepairGeneratedFields(String content, String modelCode, boolean isChinese)
        throws JsonProcessingException {
        String jsonText = extractJsonObject(content);
        try {
            return OBJECT_MAPPER.readValue(jsonText, Map.class);
        } catch (JsonProcessingException e) {
            log.warn("Meta prompt model output is not valid JSON, attempting repair once", e);
            String repairPrompt = buildJsonRepairPrompt(jsonText, isChinese);
            String repairedContent = aiService.generateText(buildJsonRepairSystemPrompt(isChinese), repairPrompt,
                modelCode, LLM_ALL_FIELDS_MAX_TOKENS);
            return OBJECT_MAPPER.readValue(extractJsonObject(repairedContent), Map.class);
        }
    }

    private String buildJsonRepairSystemPrompt(boolean isChinese) {
        if (isChinese) {
            return "你是严格的 JSON 修复器。只输出一个合法 JSON 对象，不要输出 Markdown、代码块或解释。";
        }
        return "You are a strict JSON repair tool. Output one valid JSON object only. No Markdown, code fences, or explanations.";
    }

    private String buildJsonRepairPrompt(String content, boolean isChinese) {
        if (isChinese) {
            return "下面内容应当是一个 JSON 对象，但格式不合法。请在不改变字段语义和字段名的前提下，修复为严格合法的 JSON 对象。"
                + "所有 value 保持字符串形式。只返回修复后的 JSON 对象。\n\n" + content;
        }
        return "The following content should be a JSON object but is invalid. Repair it into a strictly valid JSON object "
            + "without changing field names or semantics. Keep all values as strings. Return only the repaired JSON object.\n\n"
            + content;
    }

    private String buildAllFieldsUserPrompt(String description, String contextBlock, List<FieldSpec> specs,
        boolean isChinese) {
        StringBuilder sb = new StringBuilder();
        if (isChinese) {
            sb.append("## 用户需求描述\n").append(description).append("\n\n");
            sb.append("## 平台可用资源\n").append(contextBlock).append("\n\n");
            sb.append("## 生成任务\n");
            sb.append("一次性生成以下所有字段，返回一个严格合法的 JSON 对象。");
            sb.append("JSON 对象的 key 必须只使用字段编码，value 必须全部是字符串。");
            sb.append("如果某个字段本身要求 JSON 数组或 JSON 对象，也要把该 JSON 内容作为字符串 value 返回。");
            sb.append("不要输出 Markdown，不要输出代码块，不要添加解释。\n\n");
        } else {
            sb.append("## User Requirement\n").append(description).append("\n\n");
            sb.append("## Available Platform Resources\n").append(contextBlock).append("\n\n");
            sb.append("## Generation Task\n");
            sb.append("Generate all fields below in one strictly valid JSON object. ");
            sb.append("Object keys must be field codes only, and every value must be a string. ");
            sb.append("If a field itself requires a JSON array or object, return that JSON content as a string value. ");
            sb.append("Do not output Markdown, code fences, or explanations.\n\n");
        }

        for (FieldSpec spec : specs) {
            sb.append("- ").append(spec.fieldCode).append(": ")
                .append(isChinese ? spec.zhInstruction : spec.enInstruction)
                .append("\n");
        }
        return sb.toString();
    }

    private String stringifyFieldValue(Object value) {
        if (value == null) {
            return "";
        }
        if (value instanceof String str) {
            return str;
        }
        try {
            return OBJECT_MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            return String.valueOf(value);
        }
    }

    private String extractJsonObject(String content) {
        if (StringUtils.isBlank(content)) {
            return "{}";
        }
        String trimmed = content.trim();
        int start = trimmed.indexOf('{');
        int end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return trimmed.substring(start, end + 1);
        }
        return trimmed;
    }

    // ======================== Field Specs ========================

    private static class FieldSpec {
        final String fieldCode;
        final String zhInstruction;
        final String enInstruction;

        FieldSpec(String fieldCode, String zhInstruction, String enInstruction) {
            this.fieldCode = fieldCode;
            this.zhInstruction = zhInstruction;
            this.enInstruction = enInstruction;
        }
    }

    // 暂时写死在本地，方便调试，后面迁到数据库里面
    private List<FieldSpec> buildFieldSpecs(boolean isChinese) {
        return List.of(
            new FieldSpec("agentDescription",
                "生成智能体的一句话角色描述（resourceDesc），该描述将被编排系统用于意图路由。要求：(1) 以\"作为…\"或动作短语开头，说明该员工**具体能做什么**，而非仅给出身份标签（禁止输出仅含名称的描述如\"个人助理\"）；(2) 必须体现与其他智能体的差异点 — 哪类任务只有它能做；(3) 如果平台资源中有相关工具或知识库，明确提及能力来源（如\"依托XX知识库/XX工具\"）；(4) 40-80字，信息密度优先于简洁。",
                "Generate a one-line role description (resourceDesc) for intent routing. Requirements: (1) Start with \"As a...\" or action phrase, explain **what it can do specifically**, not just identity labels (pure labels like \"Personal Assistant\" are forbidden); (2) Highlight differentiators — what tasks only this agent can handle; (3) If platform resources exist, mention capability source (e.g. \"leveraging XX knowledge base/tool\"); (4) 40-80 characters, prioritize information density over brevity."),

            new FieldSpec("characterDescription",
                "生成智能体的角色定义（JSON字符串）。要求：定义角色名称、职责、专业领域。考虑平台可用的工具和知识库来确定角色的能力范围。直接输出角色定义文本，不要用JSON格式。",
                "Generate the agent's role definition. Requirements: define role name, responsibilities, professional domain. Consider available platform tools and knowledge bases for capability scope. Output plain text, not JSON."),

            new FieldSpec("openingRemark",
                "生成友好的开场白。要求：包含自我介绍，表达服务意愿，可以提及自己具备的能力（基于平台可用资源），30字以内。",
                "Generate a friendly opening remark. Requirements: include self-introduction, express service willingness, may mention capabilities based on available platform resources, within 30 words."),

            new FieldSpec("commonQuestions",
                "列出3个用户最可能问的常见问题。要求：严格使用JSON字符串数组格式返回，示例:[\"问题1\",\"问题2\",\"问题3\"]。问题应该与智能体的能力和可用工具/知识库相关。禁止编号，禁止换行符，直接输出标准JSON数组。",
                "List 3 most common user questions. Requirements: return strictly as JSON string array, e.g. [\"Q1\",\"Q2\",\"Q3\"]. Questions should relate to the agent's capabilities and available tools/knowledge. No numbering, no line breaks, output standard JSON array only."),

            new FieldSpec("agentTags",
                "生成3-5个标签。要求：标签能准确描述智能体功能，考虑平台可用资源来生成更精确的标签。严格使用JSON字符串数组格式返回，示例:[\"标签1\",\"标签2\",\"标签3\"]。禁止编号，直接输出标准JSON数组。",
                "Generate 3-5 tags. Requirements: tags should accurately describe agent functions, consider available platform resources for more precise tags. Return as JSON string array, e.g. [\"tag1\",\"tag2\",\"tag3\"]. No numbering, output standard JSON array only."),

            new FieldSpec("corePersonaDefinition",
                "生成智能体的人格定义。严格使用JSON数组格式返回，每个元素包含 name(中文标题)、key(英文标识)、value(具体内容)。必须包含以下3项：\n" +
                "(1) name:\"工作规范\", key:\"agent\", value 必须是一套**详细的可执行规则集**（至少5-8条），内容需覆盖：应答边界（何时拒绝、如何说明无法完成）、回答质量（逻辑严谨、数据依据、禁止编造）、输出格式（markdown排版、信息突出）、外部操作确认（邮件/发布/配置修改需征得同意）、数据安全（隐私/密钥/涉密保护、禁止高危删除）、工具调用规范。规则要根据智能体的具体业务领域定制，不能是泛泛的通用规则。参考示例：'你是专业数字员工，严格遵循下述规则完成用户需求：1.应答贴合自身定位，不越权处理超出能力范围的任务，无法完成时如实说明；2.回答逻辑严谨、内容客观，依据可用工具、知识库数据作答，无依据内容禁止编造；3.涉及外部操作必须提前征得用户确认；4.严守数据安全，不泄露隐私、密钥、业务涉密信息；5.可调用绑定工具完成数据查询和任务执行。'；\n" +
                "(2) name:\"人格定义\", key:\"soul\", value 写明核心身份、专业立场和气质风格（50-150字）；\n" +
                "(3) name:\"工具规范\", key:\"tools\", value 写明该智能体绑定工具的使用规范（如何选择工具、何时调用、调用策略、异常处理等，30-80字）。\n" +
                "value 字段**禁止留空**，必须包含具体可执行的内容。直接输出JSON数组，不要包裹代码块。",
                "Generate the agent's core persona definition. Strictly return JSON array format, each element contains name(title), key(identifier), value(content). Must include these 3 items:\n" +
                "(1) name:\"Work Standard\", key:\"agent\", value must be a **detailed actionable rule set** (at least 5-8 rules), covering: response boundaries (when/how to decline), answer quality (logical rigor, data-backed, no fabrication), output format (markdown, clear highlights), external action confirmation (require consent for emails/publishing/config changes), data security (privacy/secret protection, no destructive ops), tool invocation norms. Rules must be tailored to the agent's specific domain. Example: 'You are a professional digital employee. Follow these rules: 1. Stay within your scope and clearly state when unable to fulfill a request; 2. Be rigorous and objective, cite available tools/knowledge, never fabricate; 3. Always get user confirmation before external actions; 4. Protect data security—no privacy leaks or destructive operations; 5. Use bound tools following their invocation specs.';\n" +
                "(2) name:\"Persona\", key:\"soul\", value describes core identity, professional stance and temperament style (50-150 chars);\n" +
                "(3) name:\"Tool Standard\", key:\"tools\", value describes tool usage norms for the agent's bound tools (when/how to select, invocation strategy, error handling, 30-80 chars).\n" +
                "value field **must not be empty**, must contain specific actionable content. Output JSON array directly, no code fences."),

            new FieldSpec("coreCompetencies",
                "生成3-5组核心能力，用于编排系统的意图路由匹配。严格使用JSON数组格式返回。每组包含：coreCompetency(能力名，8字以内的动作短语)、description(一句话描述该能力做什么，30字以内)、acceptBoundary(该能力接受的任务类型，写成**用户可能说出的查询句式或关键词**，3-5条)、rejectBoundary(明确拒绝的任务类型，要与相邻领域形成**清晰切割线**而非泛泛的否定，2-4条)、example(用户真实会问的自然语言问句，2-3条，必须口语化)。格式：[{\"coreCompetency\":\"XX\",\"description\":\"XX\",\"acceptBoundary\":[\"XX\"],\"rejectBoundary\":[\"XX\"],\"example\":[\"XX\"]}]。能力定义必须基于平台可用的工具和知识库。直接输出JSON数组，不要包裹代码块。",
                "Generate 3-5 core competencies for orchestrator intent routing. Strictly return JSON array. Each includes: coreCompetency(action phrase within 8 chars), description(one-sentence capability summary, within 30 chars), acceptBoundary(accepted task types, write as **actual user query phrases or keywords**, 3-5 items), rejectBoundary(clearly rejected tasks, form **sharp boundaries with adjacent domains** not generic negatives, 2-4 items), example(natural spoken questions users would ask, 2-3 items). Format: [{\"coreCompetency\":\"XX\",\"description\":\"XX\",\"acceptBoundary\":[\"XX\"],\"rejectBoundary\":[\"XX\"],\"example\":[\"XX\"]}]. Base definitions on available platform tools and knowledge bases. Output JSON array directly, no code fences."),

            new FieldSpec("faqs",
                "生成5-8个典型用户问题示例。要求：问题应覆盖智能体的主要功能场景，考虑可用的工具和知识库能回答什么类型的问题。使用JSON字符串数组格式返回。",
                "Generate 5-8 typical user question examples. Requirements: cover main function scenarios, consider what types of questions available tools and knowledge bases can answer. Return as JSON string array."),

            new FieldSpec("roleAttributes",
                "生成角色属性定义。描述智能体的职业身份、专业知识领域、工作经验设定。要根据可用的平台资源来合理设定专业能力。输出纯文本，每项一行。",
                "Generate role attributes. Describe professional identity, knowledge domains, experience settings. Set professional capabilities based on available platform resources. Output plain text, one item per line."),

            new FieldSpec("processingFlow",
                "生成处理流程规范。定义收到用户请求后的标准处理步骤，包括：理解意图→选择工具/知识库→执行→整理输出。要引用平台实际可用的工具和知识库名称。输出纯文本，每步一行。",
                "Generate processing flow specification. Define standard steps after receiving user requests: understand intent → select tool/knowledge base → execute → organize output. Reference actual available platform tools and knowledge base names. Output plain text, one step per line."),

            new FieldSpec("personalityDimensions",
                "生成性格维度定义。描述智能体的性格特征，如：专业度、耐心度、主动性、严谨度、亲和力。输出纯文本，每个维度一行。",
                "Generate personality dimensions. Describe personality traits: professionalism, patience, proactiveness, rigor, approachability. Output plain text, one dimension per line."),

            new FieldSpec("wordPreferences",
                "生成用词偏好规范。定义智能体的用词风格，如：称呼用户的方式、专业术语使用策略、避免使用的词汇。输出纯文本，每条一行。",
                "Generate word preferences. Define word style: how to address users, professional terminology strategy, words to avoid. Output plain text, one rule per line."),

            new FieldSpec("sentenceAndTone",
                "生成句式与语气规范。定义回答的句式结构、语气特点，如：先确认问题再回答、使用什么样的过渡词、结尾是否要追问。输出纯文本，每条一行。",
                "Generate sentence and tone specification. Define sentence structure, tone characteristics: confirm question before answering, transition words, whether to ask follow-up at the end. Output plain text, one rule per line.")
        );
    }

    private String buildFieldUserPrompt(String description, String contextBlock, FieldSpec spec, boolean isChinese) {
        StringBuilder sb = new StringBuilder();
        if (isChinese) {
            sb.append("## 用户需求描述\n").append(description).append("\n\n");
            sb.append("## 平台可用资源\n").append(contextBlock).append("\n\n");
            sb.append("## 生成任务\n").append(spec.zhInstruction);
        } else {
            sb.append("## User Requirement\n").append(description).append("\n\n");
            sb.append("## Available Platform Resources\n").append(contextBlock).append("\n\n");
            sb.append("## Generation Task\n").append(spec.enInstruction);
        }
        return sb.toString();
    }

    // ======================== Context Gathering ========================

    private List<ResourceAuthVo> gatherResources() {
        try {
            ResourceUseAuthQo qo = new ResourceUseAuthQo();
            qo.setResourceBizTypeList(RESOURCE_BIZ_TYPES);
            qo.setPageNum(1);
            qo.setPageSize(200);
            PageInfo<ResourceAuthVo> page = resourceAuthApplicationService.listResourceAuth(qo);
            return page.getList() != null ? page.getList() : Collections.emptyList();
        } catch (Exception e) {
            log.warn("Failed to gather user resources for meta-prompt context", e);
            return Collections.emptyList();
        }
    }

    private String gatherBundledSkills() {
        try {
            return byaiSystemConfigService.getDcSystemConfigValueByCode("OPENCLAW_BUNDLED_SKILLS");
        } catch (Exception e) {
            log.warn("Failed to gather bundled skills for meta-prompt context", e);
            return "";
        }
    }

    // ======================== Context Building ========================

    private String buildContextBlock(List<ResourceAuthVo> resources, String bundledSkills, String lang) {
        boolean isChinese = "zh".equals(lang);
        StringBuilder ctx = new StringBuilder();

        Map<String, List<ResourceAuthVo>> grouped = resources.stream()
            .filter(r -> r.getResourceName() != null && r.getResourceBizType() != null)
            .collect(Collectors.groupingBy(ResourceAuthVo::getResourceBizType));

        appendResourceGroup(ctx, isChinese ? "可用插件 (Toolkit)" : "Available Toolkits",
            grouped.get("TOOLKIT"));
        appendResourceGroup(ctx, isChinese ? "可用 MCP 服务" : "Available MCP Services",
            grouped.get("MCP"));

        List<ResourceAuthVo> kgResources = new ArrayList<>();
        if (grouped.containsKey("KG_DOC")) {
            kgResources.addAll(grouped.get("KG_DOC"));
        }
        if (grouped.containsKey("KG_QA")) {
            kgResources.addAll(grouped.get("KG_QA"));
        }
        appendResourceGroup(ctx, isChinese ? "可用知识库" : "Available Knowledge Bases",
            kgResources);

        appendResourceGroup(ctx, isChinese ? "可用子智能体 (Agent)" : "Available Sub-Agents",
            grouped.get("AGENT"));

        List<ResourceAuthVo> dataResources = new ArrayList<>();
        if (grouped.containsKey("OBJECT")) {
            dataResources.addAll(grouped.get("OBJECT"));
        }
        if (grouped.containsKey("VIEW")) {
            dataResources.addAll(grouped.get("VIEW"));
        }
        appendResourceGroup(ctx, isChinese ? "可用数据对象/视图" : "Available Data Objects/Views",
            dataResources);

        if (StringUtils.isNotBlank(bundledSkills)) {
            ctx.append("\n--- ").append(isChinese ? "平台内置技能" : "Platform Bundled Skills").append(" ---\n");
            ctx.append(bundledSkills).append("\n");
        }

        if (ctx.isEmpty()) {
            ctx.append(isChinese ? "(当前用户暂无已授权的平台资源)" : "(No authorized platform resources found)");
        }

        return ctx.toString();
    }

    private void appendResourceGroup(StringBuilder ctx, String title, List<ResourceAuthVo> resources) {
        if (resources == null || resources.isEmpty()) {
            return;
        }
        ctx.append("\n--- ").append(title).append(" ---\n");
        int limit = Math.min(resources.size(), MAX_CONTEXT_RESOURCES);
        for (int i = 0; i < limit; i++) {
            ResourceAuthVo r = resources.get(i);
            ctx.append(i + 1).append(". ").append(r.getResourceName())
                .append(" (id: ").append(r.getResourceId())
                .append(", type: ").append(r.getResourceBizType()).append(")");
            if (StringUtils.isNotBlank(r.getResourceDesc())) {
                ctx.append(": ").append(r.getResourceDesc());
            }
            ctx.append("\n");
        }
        if (resources.size() > MAX_CONTEXT_RESOURCES) {
            ctx.append("... (").append(resources.size() - MAX_CONTEXT_RESOURCES).append(" more)\n");
        }
    }

    // ======================== Context Summary ========================

    private MetaPromptGenerateResult.ContextSummary buildContextSummary(
        List<ResourceAuthVo> resources, String bundledSkills) {
        MetaPromptGenerateResult.ContextSummary summary = new MetaPromptGenerateResult.ContextSummary();
        Map<String, Long> counts = resources.stream()
            .filter(r -> r.getResourceBizType() != null)
            .collect(Collectors.groupingBy(ResourceAuthVo::getResourceBizType, Collectors.counting()));

        summary.setAvailableToolkitCount(counts.getOrDefault("TOOLKIT", 0L).intValue());
        summary.setAvailableMcpCount(counts.getOrDefault("MCP", 0L).intValue());
        summary.setAvailableKnowledgeCount(
            counts.getOrDefault("KG_DOC", 0L).intValue() + counts.getOrDefault("KG_QA", 0L).intValue());
        summary.setAvailableAgentCount(counts.getOrDefault("AGENT", 0L).intValue());
        if (StringUtils.isNotBlank(bundledSkills)) {
            summary.setBundledSkillCount(StringUtils.countMatches(bundledSkills, "\"name\""));
        }
        return summary;
    }

    // ======================== System Prompt ========================

    private static final String SYSTEM_PROMPT_ZH = """
        你是鲸智百应平台的数字员工配置专家。你的任务是根据用户描述和平台可用资源，生成数字员工的配置字段内容。

        ## 核心原则
        1. 只引用"平台可用资源"中实际存在的工具、知识库和智能体，绝不编造不存在的资源
        2. 生成内容要具体、可执行，避免泛泛而谈
        3. 严格按照"生成任务"中的格式要求输出
        4. 直接输出内容，不要添加额外的解释或包裹代码块
        5. 如果需要JSON格式，确保输出合法的JSON
        6. 生成的描述和能力定义将被主编排 agent 用于**意图路由决策**，必须具有高区分度——让调度者仅凭描述就能判断"这件事该不该交给这个员工"

        ## 上下文感知
        - 在定义能力、流程、角色时，要考虑用户实际可用的工具和知识库
        - 如果用户有相关的知识库，处理流程中应包含"检索知识库"步骤
        - 如果用户有相关的工具/MCP服务，能力定义中应体现对这些工具的使用
        - 如果没有相关资源，仍然要生成合理的通用配置

        ## 路由区分度
        - agentDescription：必须用动作化语言说明"能做什么"，而非仅给出身份标签（"个人助理"这样的纯标签对路由毫无价值）
        - coreCompetencies 的 acceptBoundary 和 example：要写成**用户真实会说出的查询句式**，而非功能名词
        - coreCompetencies 的 rejectBoundary：要写出与相邻领域的**清晰切割线**，而非泛泛的否定

        """;

    private static final String SYSTEM_PROMPT_EN = """
        You are a digital employee configuration expert for the BeyondAI platform. Your task is to generate configuration field content based on user description and available platform resources.

        ## Core Principles
        1. Only reference tools, knowledge bases, and agents that actually exist in "Available Platform Resources" — never fabricate
        2. Generated content must be specific and actionable
        3. Strictly follow the format requirements in "Generation Task"
        4. Output content directly without extra explanations or code fences
        5. If JSON format is required, ensure valid JSON output
        6. Generated descriptions and capability definitions will be used by the main orchestrator agent for **intent routing decisions** — must be highly distinguishable, enabling the dispatcher to determine whether to assign a task to this employee based solely on the description

        ## Context Awareness
        - When defining capabilities, flows, and roles, consider the user's actually available tools and knowledge bases
        - If the user has relevant knowledge bases, include "search knowledge base" steps in processing flow
        - If the user has relevant tools/MCP services, reflect their usage in capability definitions
        - If no relevant resources exist, still generate reasonable generic configuration

        ## Routing Distinguishability
        - agentDescription: use action-oriented language to explain "what it can do", not just identity labels (pure labels like "Personal Assistant" are useless for routing)
        - coreCompetencies acceptBoundary and example: write as **actual user query phrases**, not functional nouns
        - coreCompetencies rejectBoundary: define **clear boundaries with adjacent domains**, not generic negatives
        """;
}
