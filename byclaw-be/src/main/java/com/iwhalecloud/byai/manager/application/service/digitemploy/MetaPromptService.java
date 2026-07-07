package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import com.iwhalecloud.byai.manager.dto.digitemploy.MetaPromptGenerateRequest;
import com.iwhalecloud.byai.manager.dto.digitemploy.MetaPromptGenerateResult;
import com.iwhalecloud.byai.manager.dto.digitemploy.SkillMetaPromptGenerateRequest;
import com.iwhalecloud.byai.manager.dto.digitemploy.SkillMetaPromptGenerateResult;
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
        "TOOLKIT", "TOOL", "MCP", "MCP_TOOL", "KG_DOC", "KG_QA", "KG_DB", "KG_TERM", "AGENT", "OBJECT", "VIEW"
    );

    private static final Set<String> JSON_ARRAY_FIELD_CODES = Set.of(
        "commonQuestions", "agentTags", "corePersonaDefinition", "coreCompetencies", "faqs", "acceptBoundary",
        "rejectBoundary", "recommendedResources", "generationNotes"
    );

    @Autowired
    private ResourceAuthApplicationService resourceAuthApplicationService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private AIService aiService;

    public MetaPromptGenerateResult generateV3(MetaPromptGenerateRequest request) {
        String lang = request.resolvedLang();
        String modelCode = request.getModelCode();
        boolean isChinese = "zh".equals(lang);

        List<ResourceAuthVo> resources = gatherResources();
        String bundledSkills = gatherBundledSkills();
        MetaPromptSkeleton skeleton = MetaPromptSkeletonRegistry.resolve(request.getAgentType());
        ResourceContext resourceContext = buildResourceContext(resources, request.getRelIds());
        String contextBlock = buildContextBlock(resourceContext, bundledSkills, lang);
        String systemPrompt = isChinese ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;

        List<FieldSpec> specs = buildFieldSpecs(isChinese, skeleton);

        Map<String, Object> generatedFields = generateAllFields(systemPrompt,
            buildAllFieldsUserPrompt(request, skeleton, contextBlock, specs, isChinese), modelCode, isChinese);
        Map<String, Object> fields = normalizeGeneratedFields(generatedFields, specs, skeleton, resourceContext,
            isChinese);

        MetaPromptGenerateResult result = new MetaPromptGenerateResult();
        result.setFields(fields);
        result.setContextSummary(buildContextSummary(resources, bundledSkills));
        return result;
    }

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    public void generateV3Stream(MetaPromptGenerateRequest request, OutputStream outputStream) throws IOException {
        String lang = request.resolvedLang();
        String modelCode = request.getModelCode();
        boolean isChinese = "zh".equals(lang);

        List<ResourceAuthVo> resources = gatherResources();
        String bundledSkills = gatherBundledSkills();
        MetaPromptSkeleton skeleton = MetaPromptSkeletonRegistry.resolve(request.getAgentType());
        ResourceContext resourceContext = buildResourceContext(resources, request.getRelIds());
        String contextBlock = buildContextBlock(resourceContext, bundledSkills, lang);

        String systemPrompt = isChinese ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
        List<FieldSpec> specs = buildFieldSpecs(isChinese, skeleton);

        Map<String, Object> startPayload = Map.of("contextSummary", buildContextSummary(resources, bundledSkills));
        writeSseEvent(outputStream, "start", OBJECT_MAPPER.writeValueAsString(startPayload));

        streamGeneratedFields(request, skeleton, contextBlock, specs, resourceContext, systemPrompt, modelCode,
            isChinese, outputStream);

        writeSseEvent(outputStream, "done", "[DONE]");
    }

    public SkillMetaPromptGenerateResult generateSkill(SkillMetaPromptGenerateRequest request) {
        String lang = request.resolvedLang();
        boolean isChinese = "zh".equals(lang);
        String systemPrompt = isChinese ? SKILL_SYSTEM_PROMPT_ZH : SKILL_SYSTEM_PROMPT_EN;
        String userPrompt = buildSkillUserPrompt(request, isChinese);
        Map<String, Object> generatedFields = generateAllFields(systemPrompt, userPrompt, request.getModelCode(),
            isChinese);
        return normalizeSkillGeneratedResult(generatedFields, request, isChinese);
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

    private void streamGeneratedFields(MetaPromptGenerateRequest request, MetaPromptSkeleton skeleton,
        String contextBlock, List<FieldSpec> specs, ResourceContext resourceContext, String systemPrompt,
        String modelCode, boolean isChinese, OutputStream outputStream) throws IOException {
        long startTime = System.currentTimeMillis();
        boolean acquired = false;
        try {
            LLM_SEMAPHORE.acquire();
            acquired = true;
            String userPrompt = buildAllFieldsUserPrompt(request, skeleton, contextBlock, specs, isChinese);
            String content = aiService.generateTextStream(systemPrompt, userPrompt, modelCode, LLM_ALL_FIELDS_MAX_TOKENS,
                chunk -> writeSseEvent(outputStream, "textDelta",
                    OBJECT_MAPPER.writeValueAsString(Map.of("value", chunk))));
            Map<String, Object> generatedFields = parseOrRepairGeneratedFields(content, modelCode, isChinese);
            Map<String, Object> normalizedFields = normalizeGeneratedFields(generatedFields, specs, skeleton,
                resourceContext, isChinese);
            writeSseEvent(outputStream, "finalFields", OBJECT_MAPPER.writeValueAsString(normalizedFields));
            for (FieldSpec spec : specs) {
                Map<String, String> payload = Map.of(
                    "field", spec.fieldCode,
                    "value", stringifyFieldValue(normalizedFields.get(spec.fieldCode))
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

    private String buildAllFieldsUserPrompt(MetaPromptGenerateRequest request, MetaPromptSkeleton skeleton,
        String contextBlock, List<FieldSpec> specs, boolean isChinese) {
        StringBuilder sb = new StringBuilder();
        if (isChinese) {
            sb.append("## 数字员工类型\n")
                .append("agentType: ").append(skeleton.getAgentTypeCode()).append(" / ")
                .append(skeleton.getDisplayName(true)).append("\n")
                .append("skeletonType: ").append(skeleton.getSkeletonType()).append("\n\n");
            sb.append("## 固定生成骨架\n").append(skeleton.getSkeleton(true)).append("\n\n");
            sb.append("## 用户输入与已有配置\n").append(buildExistingConfigBlock(request, true)).append("\n\n");
            sb.append("## 平台资源参考\n").append(contextBlock).append("\n\n");
            sb.append("## 生成任务\n");
            sb.append("在固定骨架下生成或优化数字员工配置字段。返回一个严格合法的 JSON 对象。");
            sb.append("JSON 对象的 key 必须只使用字段编码，value 必须全部是字符串。");
            sb.append("如果某个字段本身要求 JSON 数组或 JSON 对象，也必须把该 JSON 内容作为字符串 value 返回。");
            sb.append("不要输出 Markdown，不要输出代码块，不要添加解释。");
            sb.append("不得改变 agentType；不得编造资源 ID；推荐资源只能来自平台资源参考。\n\n");
        } else {
            sb.append("## Digital Employee Type\n")
                .append("agentType: ").append(skeleton.getAgentTypeCode()).append(" / ")
                .append(skeleton.getDisplayName(false)).append("\n")
                .append("skeletonType: ").append(skeleton.getSkeletonType()).append("\n\n");
            sb.append("## Fixed Generation Skeleton\n").append(skeleton.getSkeleton(false)).append("\n\n");
            sb.append("## User Input and Existing Configuration\n").append(buildExistingConfigBlock(request, false))
                .append("\n\n");
            sb.append("## Platform Resource Reference\n").append(contextBlock).append("\n\n");
            sb.append("## Generation Task\n");
            sb.append("Generate or optimize digital employee configuration fields under the fixed skeleton. ");
            sb.append("Return one strictly valid JSON object. Object keys must be field codes only, and every value must be a string. ");
            sb.append("If a field itself requires a JSON array or object, return that JSON content as a string value. ");
            sb.append("Do not output Markdown, code fences, or explanations. ");
            sb.append("Do not change agentType; do not invent resource IDs; recommended resources must come from the resource reference.\n\n");
        }

        for (FieldSpec spec : specs) {
            sb.append("- ").append(spec.fieldCode).append(": ")
                .append(isChinese ? spec.zhInstruction : spec.enInstruction)
                .append("\n");
        }
        return sb.toString();
    }

    private String buildSkillUserPrompt(SkillMetaPromptGenerateRequest request, boolean isChinese) {
        StringBuilder sb = new StringBuilder();
        if (isChinese) {
            sb.append("## 待生成的 skill 信息\n");
            appendInputField(sb, "候选 skill 名称", request.getSkillName());
            appendInputField(sb, "skill 目标", request.getSkillGoal());
            appendInputField(sb, "目标用户", request.getTargetUsers());
            appendInputField(sb, "应该触发的场景/问法", request.getTriggerScenarios());
            appendInputField(sb, "不应该触发的场景/边界", request.getNonTriggerScenarios());
            appendInputField(sb, "主要动作", request.getMainActions());
            appendInputField(sb, "输入与输出", request.getInputsAndOutputs());
            appendInputField(sb, "约束", request.getConstraints());
            appendInputField(sb, "已有 SKILL.md", request.getExistingSkillMd());
            appendInputField(sb, "补充参考", request.getReferenceText());
            appendListInputField(sb, "允许工具", request.getAllowedTools());
            if (sb.length() == "## 待生成的 skill 信息\n".length()) {
                sb.append("- (用户没有提供足够信息，请生成一个通用但可落地的 skill 写作模板，并在 improvementNotes 中说明需要补充的信息。)\n");
            }
            sb.append("\n## 输出要求\n");
            sb.append("返回一个严格合法的 JSON 对象，key 只能包含：skillName、description、whenToUse、allowedTools、invocationKeywords、frontmatterYaml、skillMdDraft、retrievalRationale、qualityChecklist、improvementNotes。\n");
            sb.append("allowedTools、invocationKeywords、qualityChecklist、improvementNotes 必须是 JSON 数组；其它字段必须是字符串。不要输出 Markdown 代码块或额外解释。\n");
        } else {
            sb.append("## Skill Input\n");
            appendInputField(sb, "Candidate skill name", request.getSkillName());
            appendInputField(sb, "Skill goal", request.getSkillGoal());
            appendInputField(sb, "Target users", request.getTargetUsers());
            appendInputField(sb, "Trigger scenarios / utterances", request.getTriggerScenarios());
            appendInputField(sb, "Non-trigger scenarios / boundaries", request.getNonTriggerScenarios());
            appendInputField(sb, "Main actions", request.getMainActions());
            appendInputField(sb, "Inputs and outputs", request.getInputsAndOutputs());
            appendInputField(sb, "Constraints", request.getConstraints());
            appendInputField(sb, "Existing SKILL.md", request.getExistingSkillMd());
            appendInputField(sb, "Additional reference", request.getReferenceText());
            appendListInputField(sb, "Allowed tools", request.getAllowedTools());
            if (sb.length() == "## Skill Input\n".length()) {
                sb.append("- (The user provided little information. Generate a generic but usable skill-writing template and list missing information in improvementNotes.)\n");
            }
            sb.append("\n## Output Requirements\n");
            sb.append("Return one strictly valid JSON object with only these keys: skillName, description, whenToUse, allowedTools, invocationKeywords, frontmatterYaml, skillMdDraft, retrievalRationale, qualityChecklist, improvementNotes.\n");
            sb.append("allowedTools, invocationKeywords, qualityChecklist, and improvementNotes must be JSON arrays; all other fields must be strings. Do not output Markdown code fences or extra explanations.\n");
        }
        return sb.toString();
    }

    private void appendListInputField(StringBuilder sb, String label, List<String> values) {
        if (values != null && !values.isEmpty()) {
            List<String> normalized = values.stream()
                .filter(StringUtils::isNotBlank)
                .map(String::trim)
                .collect(Collectors.toList());
            if (!normalized.isEmpty()) {
                sb.append("- ").append(label).append(": ").append(String.join(", ", normalized)).append("\n");
            }
        }
    }

    private String buildExistingConfigBlock(MetaPromptGenerateRequest request, boolean isChinese) {
        StringBuilder sb = new StringBuilder();
        appendInputField(sb, isChinese ? "用户输入/补充描述" : "User Input / Additional Description",
            request.getDescription());
        appendInputField(sb, isChinese ? "数字员工名称" : "Agent Name", request.getAgentName());
        appendInputField(sb, isChinese ? "简短描述/当前描述" : "Short Description / Current Description",
            request.getAgentDescription());
        appendInputField(sb, isChinese ? "角色定义草稿" : "Role Draft", request.getCharacterDescription());
        appendInputField(sb, isChinese ? "开场白草稿" : "Opening Remark Draft", request.getOpeningRemark());
        appendInputField(sb, isChinese ? "常见问题草稿" : "Common Questions Draft", request.getCommonQuestions());
        appendInputField(sb, isChinese ? "能力边界草稿" : "Boundary Draft", request.getConstraints());
        appendInputField(sb, isChinese ? "示例问法草稿" : "FAQ / Example Draft", request.getFaqs());
        appendInputField(sb, isChinese ? "角色属性草稿" : "Role Attributes Draft", request.getRoleAttributes());
        appendInputField(sb, isChinese ? "处理流程草稿" : "Processing Flow Draft", request.getProcessingFlow());
        appendInputField(sb, isChinese ? "性格维度草稿" : "Personality Dimensions Draft",
            request.getPersonalityDimensions());
        appendInputField(sb, isChinese ? "用词偏好草稿" : "Word Preference Draft", request.getWordPreferences());
        appendInputField(sb, isChinese ? "句式语气草稿" : "Sentence and Tone Draft", request.getSentenceAndTone());
        appendInputField(sb, isChinese ? "人格/工作/工具规范草稿" : "Persona / Work / Tool Standard Draft",
            request.getCorePersonaDefinition());
        if (sb.isEmpty()) {
            sb.append(isChinese ? "(用户仅提供了极少信息，请生成可用基础版本，并在 generationNotes 中说明缺失信息。)"
                : "(The user provided very limited information. Generate a usable baseline and describe missing information in generationNotes.)");
        }
        return sb.toString();
    }

    private void appendInputField(StringBuilder sb, String label, String value) {
        if (StringUtils.isNotBlank(value)) {
            sb.append("- ").append(label).append(": ").append(value).append("\n");
        }
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

    private Map<String, Object> normalizeGeneratedFields(Map<String, Object> generatedFields, List<FieldSpec> specs,
        MetaPromptSkeleton skeleton, ResourceContext resourceContext, boolean isChinese) {
        Map<String, Object> fields = new LinkedHashMap<>();
        for (FieldSpec spec : specs) {
            fields.put(spec.fieldCode,
                normalizeGeneratedFieldValue(spec.fieldCode, generatedFields.get(spec.fieldCode), skeleton,
                    resourceContext, isChinese));
        }

        fields.put("agentType", skeleton.getAgentTypeCode());
        fields.put("skeletonType", skeleton.getSkeletonType());

        fields.put("corePersonaDefinition",
            normalizeCorePersonaDefinition(fields.get("corePersonaDefinition"), skeleton, isChinese));
        fields.put("recommendedResources",
            normalizeRecommendedResources(fields.get("recommendedResources"), resourceContext, isChinese));
        return fields;
    }

    private Object normalizeGeneratedFieldValue(String fieldCode, Object value, MetaPromptSkeleton skeleton,
        ResourceContext resourceContext, boolean isChinese) {
        if ("corePersonaDefinition".equals(fieldCode)) {
            return normalizeCorePersonaDefinition(value, skeleton, isChinese);
        }
        if ("recommendedResources".equals(fieldCode)) {
            return normalizeRecommendedResources(value, resourceContext, isChinese);
        }
        if (JSON_ARRAY_FIELD_CODES.contains(fieldCode)) {
            return normalizeJsonArrayField(fieldCode, value);
        }
        if ("agentType".equals(fieldCode)) {
            return skeleton.getAgentTypeCode();
        }
        if ("skeletonType".equals(fieldCode)) {
            return skeleton.getSkeletonType();
        }
        return stringifyFieldValue(value);
    }

    private String normalizeJsonArrayField(String fieldCode, Object value) {
        Object parsed = parseJsonRecursively(value, 5);
        if (parsed instanceof Collection<?> collection) {
            return toJsonString(new ArrayList<>(collection));
        }
        if (parsed instanceof Map<?, ?> map) {
            return toJsonString(new ArrayList<>(map.values()));
        }
        if (parsed instanceof String str && StringUtils.isNotBlank(str)) {
            List<String> lines = Arrays.stream(str.split("\\r?\\n|；|;"))
                .map(String::trim)
                .filter(StringUtils::isNotBlank)
                .collect(Collectors.toList());
            if (Set.of("commonQuestions", "faqs", "agentTags", "acceptBoundary", "rejectBoundary", "generationNotes")
                .contains(fieldCode) && !lines.isEmpty()) {
                return toJsonString(lines);
            }
        }
        return "[]";
    }

    private Object parseJsonRecursively(Object value, int maxDepth) {
        if (maxDepth <= 0 || !(value instanceof String str)) {
            return value;
        }
        String trimmed = stripJsonFence(str);
        if (StringUtils.isBlank(trimmed)) {
            return "";
        }
        try {
            Object parsed = OBJECT_MAPPER.readValue(trimmed, Object.class);
            return parsed instanceof String ? parseJsonRecursively(parsed, maxDepth - 1) : parsed;
        } catch (Exception e) {
            return trimmed;
        }
    }

    private String stripJsonFence(String value) {
        String trimmed = value.trim();
        if (trimmed.startsWith("```")) {
            int firstLineEnd = trimmed.indexOf('\n');
            int lastFence = trimmed.lastIndexOf("```");
            if (firstLineEnd >= 0 && lastFence > firstLineEnd) {
                return trimmed.substring(firstLineEnd + 1, lastFence).trim();
            }
        }
        return trimmed;
    }

    private String normalizeCorePersonaDefinition(Object value, MetaPromptSkeleton skeleton, boolean isChinese) {
        Object parsed = parseJsonRecursively(value, 5);
        List<Map<String, Object>> configs = new ArrayList<>();
        if (parsed instanceof Collection<?> collection) {
            for (Object item : collection) {
                if (item instanceof Map<?, ?> map) {
                    Map<String, Object> config = new LinkedHashMap<>();
                    map.forEach((key, val) -> config.put(String.valueOf(key), val));
                    String promptKey = normalizePromptConfigKey(config);
                    if (StringUtils.isNotBlank(promptKey)) {
                        config.put("key", promptKey);
                        config.put("value", ensurePromptConfigValue(promptKey, config.get("value"), skeleton,
                            isChinese));
                        configs.add(config);
                    }
                }
            }
        }

        ensurePromptConfig(configs, "agent", isChinese ? "工作规范" : "Work Standard",
            skeleton.getDefaultWorkStandard(isChinese), skeleton, isChinese);
        ensurePromptConfig(configs, "soul", isChinese ? "人格定义" : "Persona",
            isChinese ? "保持专业、可靠、克制且主动的协作风格；先澄清不确定信息，再给出结构化建议。"
                : "Keep a professional, reliable, restrained, and proactive collaboration style; clarify uncertainty before giving structured suggestions.",
            skeleton, isChinese);
        ensurePromptConfig(configs, "tools", isChinese ? "工具规范" : "Tool Standard",
            defaultToolStandard(isChinese), skeleton, isChinese);
        return toJsonString(configs);
    }

    private String normalizePromptConfigKey(Map<String, Object> config) {
        List<String> candidates = new ArrayList<>();
        candidates.add(stringValue(config.get("key")));
        candidates.add(stringValue(config.get("name")));
        candidates.add(stringValue(config.get("nameEn")));
        for (String candidate : candidates) {
            if (StringUtils.equalsAnyIgnoreCase(candidate, "agent", "workStandard", "work standard", "工作规范",
                "work specification")) {
                return "agent";
            }
            if (StringUtils.equalsAnyIgnoreCase(candidate, "soul", "persona", "personality", "人格定义",
                "personality definition")) {
                return "soul";
            }
            if (StringUtils.equalsAnyIgnoreCase(candidate, "tools", "tool", "toolStandard", "tool standard", "工具规范",
                "tool specification")) {
                return "tools";
            }
        }
        return stringValue(config.get("key"));
    }

    private Object ensurePromptConfigValue(String key, Object value, MetaPromptSkeleton skeleton, boolean isChinese) {
        String text = stringifyFieldValue(value);
        if (StringUtils.isBlank(text)) {
            if ("agent".equals(key)) {
                return skeleton.getDefaultWorkStandard(isChinese);
            }
            if ("tools".equals(key)) {
                return defaultToolStandard(isChinese);
            }
            return isChinese ? "保持专业、可靠、克制且主动的协作风格。"
                : "Maintain a professional, reliable, restrained, and proactive collaboration style.";
        }
        return text;
    }

    private void ensurePromptConfig(List<Map<String, Object>> configs, String key, String name, String defaultValue,
        MetaPromptSkeleton skeleton, boolean isChinese) {
        for (Map<String, Object> config : configs) {
            if (StringUtils.equals(key, stringValue(config.get("key")))) {
                config.put("value", ensurePromptConfigValue(key, config.get("value"), skeleton, isChinese));
                return;
            }
        }
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("name", name);
        config.put("key", key);
        config.put("value", ensurePromptConfigValue(key, defaultValue, skeleton, isChinese));
        configs.add(config);
    }

    private String defaultToolStandard(boolean isChinese) {
        return isChinese
            ? "仅记录建议挂载的资源类型、适用场景、输入输出边界和失败提示原则；实际资源绑定与调用方式由平台运行时注入。不得编造资源 ID，不得声称未挂载能力。"
            : "Record only recommended resource types, applicable scenarios, input/output boundaries, and failure-message principles. Actual resource binding and invocation are injected by the platform runtime. Do not invent resource IDs or claim unmounted capabilities.";
    }

    private String normalizeRecommendedResources(Object value, ResourceContext resourceContext, boolean isChinese) {
        Object parsed = parseJsonRecursively(value, 5);
        if (!(parsed instanceof Collection<?> collection)) {
            return "[]";
        }
        List<Map<String, Object>> resources = new ArrayList<>();
        Set<String> seenResourceIds = new HashSet<>();
        for (Object item : collection) {
            if (!(item instanceof Map<?, ?> map)) {
                continue;
            }
            String resourceId = stringValue(map.get("resourceId"));
            ResourceAuthVo resource = resourceContext.resourceById.get(resourceId);
            if (resource == null || !seenResourceIds.add(resourceId)) {
                continue;
            }
            Map<String, Object> normalized = new LinkedHashMap<>();
            normalized.put("resourceId", resourceId);
            normalized.put("resourceName", resource.getResourceName());
            normalized.put("resourceBizType", resource.getResourceBizType());
            normalized.put("priority", normalizePriority(stringValue(map.get("priority"))));
            String reason = stringValue(map.get("reason"));
            normalized.put("reason", StringUtils.defaultIfBlank(reason,
                StringUtils.defaultIfBlank(resource.getResourceDesc(), isChinese ? "与该数字员工职责相关。"
                    : "Relevant to this digital employee's responsibilities.")));
            normalized.put("usageInstruction", StringUtils.defaultIfBlank(stringValue(map.get("usageInstruction")),
                isChinese ? "建议挂载后用于相关任务；实际调用方式由平台运行时注入。"
                    : "Recommended for related tasks after mounting; actual invocation is injected by the platform runtime."));
            resources.add(normalized);
            if (resources.size() >= 10) {
                break;
            }
        }
        return toJsonString(resources);
    }

    private String normalizePriority(String priority) {
        if (StringUtils.equalsAnyIgnoreCase(priority, "high", "medium", "low")) {
            return priority.toLowerCase(Locale.ROOT);
        }
        return "medium";
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    private String toJsonString(Object value) {
        try {
            return OBJECT_MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            return "[]";
        }
    }

    private SkillMetaPromptGenerateResult normalizeSkillGeneratedResult(Map<String, Object> generatedFields,
        SkillMetaPromptGenerateRequest request, boolean isChinese) {
        SkillMetaPromptGenerateResult result = new SkillMetaPromptGenerateResult();
        String skillName = StringUtils.defaultIfBlank(stringValue(generatedFields.get("skillName")),
            normalizeSkillDirectoryName(request.getSkillName(), isChinese));
        String description = StringUtils.defaultIfBlank(stringValue(generatedFields.get("description")),
            defaultSkillDescription(request, isChinese));
        String whenToUse = StringUtils.defaultIfBlank(stringValue(generatedFields.get("whenToUse")),
            defaultSkillWhenToUse(request, isChinese));
        List<String> allowedTools = normalizeStringList(generatedFields.get("allowedTools"), request.getAllowedTools());
        List<String> invocationKeywords = normalizeStringList(generatedFields.get("invocationKeywords"),
            buildDefaultInvocationKeywords(skillName, request));
        String frontmatterYaml = StringUtils.defaultIfBlank(stringValue(generatedFields.get("frontmatterYaml")),
            buildSkillFrontmatterYaml(skillName, description, whenToUse, allowedTools));
        String skillMdDraft = StringUtils.defaultIfBlank(stringValue(generatedFields.get("skillMdDraft")),
            buildFallbackSkillMdDraft(frontmatterYaml, request, isChinese));
        String retrievalRationale = StringUtils.defaultIfBlank(stringValue(generatedFields.get("retrievalRationale")),
            isChinese
                ? "已优先强化 skillName 与 whenToUse 中的高权重关键词，并在 description 中补充同义触发词。"
                : "Prioritized high-weight keywords in skillName and whenToUse, with synonym trigger terms in description.");
        List<String> qualityChecklist = normalizeStringList(generatedFields.get("qualityChecklist"),
            defaultSkillQualityChecklist(isChinese));
        List<String> improvementNotes = normalizeStringList(generatedFields.get("improvementNotes"),
            Collections.emptyList());

        result.setSkillName(skillName);
        result.setDescription(description);
        result.setWhenToUse(whenToUse);
        result.setAllowedTools(allowedTools);
        result.setInvocationKeywords(invocationKeywords);
        result.setFrontmatterYaml(frontmatterYaml);
        result.setSkillMdDraft(skillMdDraft);
        result.setRetrievalRationale(retrievalRationale);
        result.setQualityChecklist(qualityChecklist);
        result.setImprovementNotes(improvementNotes);
        return result;
    }

    private List<String> normalizeStringList(Object value, List<String> fallback) {
        Object parsed = parseJsonRecursively(value, 5);
        List<String> result = new ArrayList<>();
        if (parsed instanceof Collection<?> collection) {
            for (Object item : collection) {
                String text = stringValue(item);
                if (StringUtils.isNotBlank(text)) {
                    result.add(text);
                }
            }
        }
        else if (parsed instanceof String str && StringUtils.isNotBlank(str)) {
            result.addAll(Arrays.stream(str.split("\\r?\\n|；|;|,|，"))
                .map(String::trim)
                .filter(StringUtils::isNotBlank)
                .collect(Collectors.toList()));
        }
        if (result.isEmpty() && fallback != null) {
            result.addAll(fallback.stream()
                .filter(StringUtils::isNotBlank)
                .map(String::trim)
                .collect(Collectors.toList()));
        }
        return result.stream().distinct().collect(Collectors.toList());
    }

    private String normalizeSkillDirectoryName(String rawName, boolean isChinese) {
        String normalized = StringUtils.trimToEmpty(rawName)
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", "-")
            .replaceAll("^-+|-+$", "");
        if (StringUtils.isNotBlank(normalized)) {
            return normalized;
        }
        return isChinese ? "custom-skill" : "custom-skill";
    }

    private String defaultSkillDescription(SkillMetaPromptGenerateRequest request, boolean isChinese) {
        if (StringUtils.isNotBlank(request.getSkillGoal())) {
            return request.getSkillGoal().trim();
        }
        if (StringUtils.isNotBlank(request.getMainActions())) {
            return request.getMainActions().trim();
        }
        return isChinese ? "指导模型在特定场景下按稳定流程完成任务。" : "Guide the model to complete a task with a stable workflow in specific scenarios.";
    }

    private String defaultSkillWhenToUse(SkillMetaPromptGenerateRequest request, boolean isChinese) {
        if (StringUtils.isNotBlank(request.getTriggerScenarios())) {
            return request.getTriggerScenarios().trim();
        }
        if (StringUtils.isNotBlank(request.getSkillGoal())) {
            return request.getSkillGoal().trim();
        }
        return isChinese ? "当用户请求创建、优化或执行该 skill 覆盖的任务时使用。" : "Use when the user asks to create, optimize, or perform the task covered by this skill.";
    }

    private List<String> buildDefaultInvocationKeywords(String skillName, SkillMetaPromptGenerateRequest request) {
        List<String> keywords = new ArrayList<>();
        keywords.add(skillName);
        keywords.addAll(Arrays.asList(skillName.split("-")));
        if (StringUtils.isNotBlank(request.getSkillGoal())) {
            keywords.add(request.getSkillGoal());
        }
        if (StringUtils.isNotBlank(request.getTriggerScenarios())) {
            keywords.add(request.getTriggerScenarios());
        }
        return keywords;
    }

    private String buildSkillFrontmatterYaml(String skillName, String description, String whenToUse,
        List<String> allowedTools) {
        StringBuilder sb = new StringBuilder();
        sb.append("---\n");
        sb.append("name: ").append(skillName).append("\n");
        sb.append("description: ").append(quoteYaml(description)).append("\n");
        sb.append("whenToUse: ").append(quoteYaml(whenToUse)).append("\n");
        if (allowedTools != null && !allowedTools.isEmpty()) {
            sb.append("allowedTools:\n");
            for (String tool : allowedTools) {
                sb.append("  - ").append(quoteYaml(tool)).append("\n");
            }
        }
        sb.append("---");
        return sb.toString();
    }

    private String quoteYaml(String value) {
        return "'" + StringUtils.trimToEmpty(value).replace("'", "''") + "'";
    }

    private String buildFallbackSkillMdDraft(String frontmatterYaml, SkillMetaPromptGenerateRequest request,
        boolean isChinese) {
        String goal = defaultSkillDescription(request, isChinese);
        String trigger = defaultSkillWhenToUse(request, isChinese);
        if (isChinese) {
            return frontmatterYaml + "\n\n# Skill Instructions\n\n"
                + "## 目标\n" + goal + "\n\n"
                + "## 何时使用\n" + trigger + "\n\n"
                + "## 工作流程\n"
                + "1. 先确认用户请求是否命中 whenToUse 中的场景和关键词。\n"
                + "2. 读取用户输入、已有文件、上下文和允许工具，判断缺失信息。\n"
                + "3. 按该 skill 的主要动作分步骤执行，并在关键节点给出可验证产物。\n"
                + "4. 如果请求落入不触发边界，说明原因并给出更合适的处理方向。\n\n"
                + "## 边界\n" + StringUtils.defaultIfBlank(request.getNonTriggerScenarios(), "不要处理与该 skill 目标无关的任务。") + "\n";
        }
        return frontmatterYaml + "\n\n# Skill Instructions\n\n"
            + "## Goal\n" + goal + "\n\n"
            + "## When To Use\n" + trigger + "\n\n"
            + "## Workflow\n"
            + "1. Confirm whether the user request matches the scenarios and keywords in whenToUse.\n"
            + "2. Read user input, existing files, context, and allowed tools; identify missing information.\n"
            + "3. Execute the main actions step by step and produce verifiable artifacts at key points.\n"
            + "4. If the request falls outside the trigger boundary, explain why and suggest a better path.\n\n"
            + "## Boundaries\n" + StringUtils.defaultIfBlank(request.getNonTriggerScenarios(),
                "Do not handle tasks unrelated to this skill goal.") + "\n";
    }

    private List<String> defaultSkillQualityChecklist(boolean isChinese) {
        if (isChinese) {
            return List.of(
                "skillName 使用短横线连接，包含任务核心动词和对象名词。",
                "whenToUse 写入用户真实会说的触发词、同义词和场景词。",
                "description 补充能力边界，不只写抽象价值描述。",
                "allowedTools 只列真实需要的工具，避免靠低权重字段承载核心召回词。",
                "SKILL.md 明确工作流程、输入输出、边界和失败处理。"
            );
        }
        return List.of(
            "skillName is hyphenated and includes core action and object nouns.",
            "whenToUse includes realistic user trigger words, synonyms, and scenario terms.",
            "description adds capability boundaries instead of abstract value claims only.",
            "allowedTools lists only truly needed tools and does not carry core retrieval terms alone.",
            "SKILL.md defines workflow, inputs, outputs, boundaries, and failure handling."
        );
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

    // 暂时写死在本地，方便调试，后面迁到数据库/配置中心。
    private List<FieldSpec> buildFieldSpecs(boolean isChinese, MetaPromptSkeleton skeleton) {
        return List.of(
            new FieldSpec("agentDescription",
                "生成一句话角色描述（resourceDesc），用于主编排 Agent 路由。要求：动作化说明该员工具体能做什么；体现与相邻员工的差异；如涉及平台资源，只表达“建议挂载相关资源/依赖平台资源支持”，不得声称已拥有未挂载能力；40-80字。",
                "Generate a one-line role description (resourceDesc) for orchestrator routing. Use action-oriented wording, highlight differences from adjacent employees, and when platform resources are involved only say related resources are recommended or platform support is required; do not claim unmounted capabilities. 40-80 chars."),

            new FieldSpec("characterDescription",
                "生成角色定义。要求：基于固定骨架说明角色名称、职责、专业领域、工作边界；保留用户已有设定的核心意图，以结构化润色为主；输出纯文本。",
                "Generate the role definition. Based on the fixed skeleton, describe role name, responsibilities, domain, and boundaries. Preserve the user's core intent and mainly polish/structure existing settings. Output plain text."),

            new FieldSpec("openingRemark",
                "生成友好的开场白。要求：符合数字员工类型，包含自我介绍和服务意愿，不夸大未挂载资源能力，30字以内。",
                "Generate a friendly opening remark aligned with the employee type. Include self-introduction and willingness to help, without overstating unmounted resource capabilities. Within 30 words."),

            new FieldSpec("commonQuestions",
                "列出3个用户最可能问的开场问题。严格返回JSON数组字符串，如[\"问题1\",\"问题2\",\"问题3\"]。问题要贴合该类型骨架和用户真实意图，禁止编号。",
                "List 3 likely starter questions. Return strictly as a JSON array string, e.g. [\"Q1\",\"Q2\",\"Q3\"]. Questions must fit the type skeleton and user intent. No numbering."),

            new FieldSpec("agentTags",
                "生成3-5个标签。严格返回JSON数组字符串。标签要描述类型、业务域和核心任务，不要把候选资源名直接当标签。",
                "Generate 3-5 tags as a JSON array string. Tags should describe type, domain, and core tasks; do not simply use candidate resource names as tags."),

            new FieldSpec("corePersonaDefinition",
                "生成核心提示词配置，严格返回JSON数组字符串，每个元素包含name、key、value。必须包含3项：(1) name:\"工作规范\", key:\"agent\", value 按AGENTS.md思想写职责、流程、边界、路由规则，至少5-8条；如涉及平台资源，只写资源依赖、适用场景和未挂载/不可用时的限制说明，不写具体调用入口；(2) name:\"人格定义\", key:\"soul\", value 写表达风格和协作气质；(3) name:\"工具规范\", key:\"tools\", value 按TOOL.md思想写建议资源类型、使用边界、输入输出要求和失败提示原则；资源绑定与调用方式由平台运行时注入。value禁止留空。",
                "Generate core prompt configuration as a JSON array string. Each item must contain name, key, value. Include exactly these core items: (1) name:\"Work Standard\", key:\"agent\", value follows AGENTS.md thinking with responsibilities, workflow, boundaries, routing rules, and 5-8 actionable rules; when platform resources are involved, describe resource dependency, applicable scenarios, and limitations when unmounted/unavailable, but do not write concrete invocation entry points; (2) name:\"Persona\", key:\"soul\", value describes style and collaboration temperament; (3) name:\"Tool Standard\", key:\"tools\", value follows TOOL.md thinking with recommended resource types, usage boundaries, input/output requirements, and failure-message principles. Resource binding and invocation are injected by the platform runtime. Values cannot be empty."),

            new FieldSpec("coreCompetencies",
                "生成3-5组核心能力，用于主编排 Agent 路由。严格返回JSON数组字符串。每组包含coreCompetency(8字内动作短语)、description(30字内)、acceptBoundary(用户会说出的问法/关键词3-5条)、rejectBoundary(清晰拒绝边界2-4条)、example(口语化示例2-3条)。能力必须符合固定骨架，不要写成泛泛能力名。",
                "Generate 3-5 core competencies for orchestrator routing as a JSON array string. Each item includes coreCompetency(action phrase within 8 chars), description(within 30 chars), acceptBoundary(actual user phrases/keywords, 3-5), rejectBoundary(sharp boundaries, 2-4), example(spoken examples, 2-3). Must follow the skeleton; avoid generic ability names."),

            new FieldSpec("faqs",
                "生成5-8个典型用户问题示例，严格返回JSON数组字符串，覆盖主要适用场景，并避免超出拒绝边界。",
                "Generate 5-8 typical user question examples as a JSON array string, covering major applicable scenarios and avoiding rejected boundaries."),

            new FieldSpec("roleAttributes",
                "生成角色属性定义。描述职业身份、专业领域、经验设定和能力来源边界。输出纯文本，每项一行。",
                "Generate role attributes: professional identity, domains, experience setting, and capability-source boundaries. Output plain text, one item per line."),

            new FieldSpec("processingFlow",
                "生成处理流程规范。必须符合固定骨架，包含：理解意图、澄清缺失信息、判断是否依赖平台资源、校验资源可用性、整理输出、资源不可用时的兜底说明。不要写具体调用入口。输出纯文本，每步一行。",
                "Generate processing flow following the fixed skeleton: understand intent, clarify missing info, decide whether platform resources are needed, check resource availability, organize output, and provide fallback messaging when resources are unavailable. Do not write concrete invocation entry points. Output plain text, one step per line."),

            new FieldSpec("personalityDimensions",
                "生成性格维度定义。描述智能体的性格特征，如：专业度、耐心度、主动性、严谨度、亲和力。输出纯文本，每个维度一行。",
                "Generate personality dimensions. Describe personality traits: professionalism, patience, proactiveness, rigor, approachability. Output plain text, one dimension per line."),

            new FieldSpec("wordPreferences",
                "生成用词偏好规范。定义智能体的用词风格，如：称呼用户的方式、专业术语使用策略、避免使用的词汇。输出纯文本，每条一行。",
                "Generate word preferences. Define word style: how to address users, professional terminology strategy, words to avoid. Output plain text, one rule per line."),

            new FieldSpec("sentenceAndTone",
                "生成句式与语气规范。定义回答的句式结构、语气特点，如：先确认问题再回答、使用什么样的过渡词、结尾是否要追问。输出纯文本，每条一行。",
                "Generate sentence and tone specification. Define sentence structure, tone characteristics: confirm question before answering, transition words, whether to ask follow-up at the end. Output plain text, one rule per line."),

            new FieldSpec("agentType",
                "返回固定值\"" + skeleton.getAgentTypeCode() + "\"，不得改变。",
                "Return the fixed value \"" + skeleton.getAgentTypeCode() + "\". Do not change it."),

            new FieldSpec("skeletonType",
                "返回固定值\"" + skeleton.getSkeletonType() + "\"，表示本次使用的骨架版本。",
                "Return the fixed value \"" + skeleton.getSkeletonType() + "\" as the skeleton version used."),

            new FieldSpec("intentSummary",
                "用1-2句话总结你从名称、描述和已有配置中推测出的用户真实创建意图。不要编造行业、公司制度或内部流程。",
                "Summarize the inferred user intent from name, description, and existing configuration in 1-2 sentences. Do not invent industries, policies, or internal workflows."),

            new FieldSpec("routingDescription",
                "生成给主编排 Agent 使用的路由描述。说明什么请求应该交给该数字员工、为什么它比相邻员工更适合。80-150字。",
                "Generate a routing description for the orchestrator: what requests should be assigned to this employee and why it is more suitable than adjacent employees. 80-150 chars."),

            new FieldSpec("acceptBoundary",
                "生成适合交给该数字员工的请求边界，严格返回JSON数组字符串。每项必须是用户可能说出的问法或关键词，5-8项。",
                "Generate accepted request boundaries as a JSON array string. Each item must be a possible user utterance or keyword. 5-8 items."),

            new FieldSpec("rejectBoundary",
                "生成不适合交给该数字员工的请求边界，严格返回JSON数组字符串。要与相邻领域形成清晰切割线，4-6项。",
                "Generate rejected request boundaries as a JSON array string. Make sharp boundaries with adjacent domains. 4-6 items."),

            new FieldSpec("recommendedResources",
                "生成建议挂载资源，严格返回JSON数组字符串。只能从平台资源参考中选择真实resourceId。每项包含resourceId(字符串)、resourceName、resourceBizType、priority(high/medium/low)、reason、usageInstruction。usageInstruction只描述建议用途、适用场景和边界，不写具体调用入口。没有合适资源时返回[]。",
                "Generate recommended mount resources as a JSON array string. Select only real resourceId values from the platform resource reference. Each item contains resourceId(string), resourceName, resourceBizType, priority(high/medium/low), reason, usageInstruction. usageInstruction should describe recommended use, applicable scenarios, and boundaries only, without concrete invocation entry points. Return [] if none fit."),

            new FieldSpec("generationNotes",
                "生成本次生成说明，严格返回JSON数组字符串。用于记录缺失信息、保留用户已有设定、类型骨架约束或资源不足提醒。没有说明时返回[]。",
                "Generate generation notes as a JSON array string: missing information, preserved user settings, type skeleton constraints, or resource gaps. Return [] if none.")
        );
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

    private ResourceContext buildResourceContext(List<ResourceAuthVo> resources, List<String> relIds) {
        Set<String> selectedIdSet = relIds == null ? Collections.emptySet() : relIds.stream()
            .filter(StringUtils::isNotBlank)
            .map(String::trim)
            .collect(Collectors.toCollection(LinkedHashSet::new));

        Map<String, ResourceAuthVo> resourceById = resources.stream()
            .filter(r -> r.getResourceId() != null)
            .collect(Collectors.toMap(r -> String.valueOf(r.getResourceId()), r -> r, (left, right) -> left,
                LinkedHashMap::new));

        List<ResourceAuthVo> selectedResources = resources.stream()
            .filter(r -> r.getResourceId() != null && selectedIdSet.contains(String.valueOf(r.getResourceId())))
            .collect(Collectors.toList());
        List<ResourceAuthVo> candidateResources = resources.stream()
            .filter(r -> r.getResourceId() == null || !selectedIdSet.contains(String.valueOf(r.getResourceId())))
            .collect(Collectors.toList());
        return new ResourceContext(selectedResources, candidateResources, resourceById);
    }

    private String buildContextBlock(ResourceContext resourceContext, String bundledSkills, String lang) {
        boolean isChinese = "zh".equals(lang);
        StringBuilder ctx = new StringBuilder();

        appendResourceGroup(ctx, isChinese ? "用户已选/当前关联资源（重点参考，不代表一定启用全部能力）"
            : "User Selected / Currently Related Resources (priority reference; do not overclaim capabilities)",
            resourceContext.selectedResources);

        Map<String, List<ResourceAuthVo>> grouped = resourceContext.candidateResources.stream()
            .filter(r -> r.getResourceName() != null && r.getResourceBizType() != null)
            .collect(Collectors.groupingBy(ResourceAuthVo::getResourceBizType));

        appendResourceGroup(ctx, isChinese ? "候选插件/工具 (Toolkit/Tool，仅供推荐挂载)"
            : "Candidate Toolkits/Tools (recommendation only)",
            grouped.get("TOOLKIT"));
        appendResourceGroup(ctx, isChinese ? "候选工具 (Tool，仅供推荐挂载)"
            : "Candidate Tools (recommendation only)",
            grouped.get("TOOL"));
        appendResourceGroup(ctx, isChinese ? "候选 MCP 服务（仅供推荐挂载）" : "Candidate MCP Services (recommendation only)",
            grouped.get("MCP"));
        appendResourceGroup(ctx, isChinese ? "候选 MCP 工具（仅供推荐挂载）" : "Candidate MCP Tools (recommendation only)",
            grouped.get("MCP_TOOL"));

        List<ResourceAuthVo> kgResources = new ArrayList<>();
        addIfPresent(kgResources, grouped, "KG_DOC");
        addIfPresent(kgResources, grouped, "KG_QA");
        addIfPresent(kgResources, grouped, "KG_DB");
        addIfPresent(kgResources, grouped, "KG_TERM");
        appendResourceGroup(ctx, isChinese ? "候选知识库（仅供推荐挂载）" : "Candidate Knowledge Bases (recommendation only)",
            kgResources);

        appendResourceGroup(ctx, isChinese ? "候选子智能体 (Agent，仅供推荐挂载)"
            : "Candidate Sub-Agents (recommendation only)",
            grouped.get("AGENT"));

        List<ResourceAuthVo> dataResources = new ArrayList<>();
        addIfPresent(dataResources, grouped, "OBJECT");
        addIfPresent(dataResources, grouped, "VIEW");
        appendResourceGroup(ctx, isChinese ? "候选数据对象/视图（仅供推荐挂载）"
            : "Candidate Data Objects/Views (recommendation only)",
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

    private void addIfPresent(List<ResourceAuthVo> target, Map<String, List<ResourceAuthVo>> grouped,
        String resourceBizType) {
        if (grouped.containsKey(resourceBizType)) {
            target.addAll(grouped.get(resourceBizType));
        }
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

    private static class ResourceContext {
        final List<ResourceAuthVo> selectedResources;
        final List<ResourceAuthVo> candidateResources;
        final Map<String, ResourceAuthVo> resourceById;

        ResourceContext(List<ResourceAuthVo> selectedResources, List<ResourceAuthVo> candidateResources,
            Map<String, ResourceAuthVo> resourceById) {
            this.selectedResources = selectedResources;
            this.candidateResources = candidateResources;
            this.resourceById = resourceById;
        }
    }

    // ======================== Context Summary ========================

    private MetaPromptGenerateResult.ContextSummary buildContextSummary(
        List<ResourceAuthVo> resources, String bundledSkills) {
        MetaPromptGenerateResult.ContextSummary summary = new MetaPromptGenerateResult.ContextSummary();
        Map<String, Long> counts = resources.stream()
            .filter(r -> r.getResourceBizType() != null)
            .collect(Collectors.groupingBy(ResourceAuthVo::getResourceBizType, Collectors.counting()));

        summary.setAvailableToolkitCount(
            counts.getOrDefault("TOOLKIT", 0L).intValue() + counts.getOrDefault("TOOL", 0L).intValue());
        summary.setAvailableMcpCount(
            counts.getOrDefault("MCP", 0L).intValue() + counts.getOrDefault("MCP_TOOL", 0L).intValue());
        summary.setAvailableKnowledgeCount(
            counts.getOrDefault("KG_DOC", 0L).intValue() + counts.getOrDefault("KG_QA", 0L).intValue()
                + counts.getOrDefault("KG_DB", 0L).intValue() + counts.getOrDefault("KG_TERM", 0L).intValue());
        summary.setAvailableAgentCount(counts.getOrDefault("AGENT", 0L).intValue());
        if (StringUtils.isNotBlank(bundledSkills)) {
            summary.setBundledSkillCount(StringUtils.countMatches(bundledSkills, "\"name\""));
        }
        return summary;
    }

    // ======================== System Prompt ========================

    private static final String SYSTEM_PROMPT_ZH = """
        你是鲸智百应平台的数字员工提示词架构师。数字员工本质上是百应平台中的 Agent。
        你的任务不是自由发挥设计骨架，而是在系统提供的固定骨架下，根据用户显式选择的数字员工类型、名称、简短描述、已有配置和平台资源参考，生成或优化数字员工配置字段，让它职责清晰、边界明确、便于主编排 Agent 准确路由。

        ## 核心原则
        1. agentType 和固定骨架由系统提供，不得擅自改变类型或骨架意图。
        2. 优先生成职责、流程、边界、路由特征和资源建议规范，避免堆砌空泛人设。
        3. 用户已有配置代表用户设定，应以骨架化润色和补齐为主，避免过度改写。
        4. 平台资源只是参考和推荐候选，不代表已经绑定；不得声称拥有未挂载能力。
        5. 只引用"平台资源参考"中实际存在的资源，绝不编造资源名称、ID 或能力。
        6. 不要生成具体资源调用入口或运行时调用语法；资源绑定、调用入口和执行方式由平台后台注入。
        7. 不得模拟工具结果；资源未挂载、不可用、信息不足或超出职责时，必须说明限制并请求用户补充或确认。
        8. 严格按照"生成任务"中的格式要求输出合法 JSON，不要输出 Markdown、代码块或额外解释。

        ## 资源态度
        - 用户已选/当前关联资源：可作为重点参考，但不要模拟结果，不要写具体调用入口。
        - 候选资源：只能用于 recommendedResources 推荐，不要写成已绑定能力。
        - 平台内置技能：可以作为能力设计参考；实际启用和调用方式由平台运行时处理。

        ## 路由区分度
        - agentDescription 必须用动作化语言说明"能做什么"，不能只给身份标签。
        - routingDescription 要让主编排 Agent 知道什么请求应该交给它。
        - coreCompetencies、acceptBoundary、example 要写成用户真实会说出的问法或关键词。
        - rejectBoundary 要写出与相邻领域的清晰切割线。

        """;

    private static final String SYSTEM_PROMPT_EN = """
        You are a digital employee prompt architect for the BeyondAI platform. A digital employee is an Agent in the platform.
        Your task is not to invent a skeleton freely. Under the fixed skeleton provided by the system, generate or optimize configuration fields from the explicit digital employee type, name, short description, existing configuration, and platform resource reference, so the employee has clear responsibilities, boundaries, and routing signals for the orchestrator.

        ## Core Principles
        1. agentType and the fixed skeleton are provided by the system; do not change the type or skeleton intent.
        2. Prioritize responsibilities, workflow, boundaries, routing signals, and resource recommendation norms over vague persona text.
        3. Existing user configuration represents user intent; mainly polish, structure, and complete it without over-rewriting.
        4. Platform resources are references and recommendation candidates only; do not claim unmounted capabilities.
        5. Only reference resources that actually appear in "Platform Resource Reference"; never fabricate resource names, IDs, or capabilities.
        6. Do not generate concrete resource invocation entry points or runtime call syntax; resource binding, invocation entry points, and execution are injected by the platform backend.
        7. Never simulate tool results. If resources are unmounted, unavailable, information is insufficient, or requests are out of scope, state limitations and ask for confirmation or more information.
        8. Strictly follow the output format in "Generation Task"; output valid JSON only, without Markdown, code fences, or extra explanations.

        ## Resource Attitude
        - User selected/currently related resources: priority references, but do not simulate results or write concrete invocation entry points.
        - Candidate resources: use only for recommendedResources; do not write them as mounted capabilities.
        - Platform bundled skills: may inform capability design; actual enablement and invocation are handled by the platform runtime.

        ## Routing Distinguishability
        - agentDescription must explain "what it can do" with action-oriented language, not identity labels.
        - routingDescription must help the orchestrator decide what requests should be assigned to it.
        - coreCompetencies, acceptBoundary, and examples must be actual user phrases or keywords.
        - rejectBoundary must define sharp boundaries with adjacent domains.
        """;

    private static final String SKILL_SYSTEM_PROMPT_ZH = """
        你是 Claude Code、OpenClaw、Codex 等 Agent 框架的 skill 元提示词架构师。
        你的任务是帮助用户把一个模糊能力，设计成更容易被模型检索、召回并正确执行的 SKILL.md。

        ## 你必须理解的召回机制
        当前主流 skill 召回不是语义向量检索，而是偏关键词、分词、词干化的匹配：
        1. 只索引 type=prompt 且未 disableModelInvocation 的技能。
        2. name 会被分词、词干化，并额外拆解 hyphen/underscore 片段，例如 create-chart_tool 会拆成 create/chart/tool。
        3. description、whenToUse、allowedTools 也会被分词和词干化。
        4. 字段权重大致为：name 最高，whenToUse 次高，description 中等，allowedTools 较低。
        5. 因此不要只写漂亮但抽象的语义描述；必须把用户真实会说的任务词、对象词、同义词、英文/缩写、边界词放进 name、whenToUse、description。

        ## 设计原则
        1. skillName 应该短、稳定、kebab-case，包含核心动作 + 核心对象，例如 create-ppt-outline、debug-sql-query。
        2. whenToUse 是召回主战场，要写真实用户问法、触发场景、关键词、同义词和不该触发的相邻边界。
        3. description 用一句话说明能做什么、产出什么、适用边界，不要写成营销语。
        4. allowedTools 只放执行需要的真实工具；不要把核心召回词只塞在 allowedTools，因为它权重低。
        5. SKILL.md 正文要指导模型如何做事：何时使用、输入、流程、产物、质量标准、失败处理、边界。
        6. 如果用户信息不足，要生成可用基础版，并在 improvementNotes 中明确缺什么。

        ## 输出内容
        - skillName：优化后的目录名/技能名。
        - description：适合 frontmatter 的短描述。
        - whenToUse：适合 frontmatter 的触发说明，要覆盖关键词召回。
        - allowedTools：建议允许工具列表。
        - invocationKeywords：召回关键词清单，用于人工检查。
        - frontmatterYaml：完整 YAML frontmatter。
        - skillMdDraft：可直接保存为 SKILL.md 的草稿。
        - retrievalRationale：解释为什么这样写更容易召回。
        - qualityChecklist：人工验收清单。
        - improvementNotes：仍需用户补充或人工确认的点。

        严格返回合法 JSON；不要输出 Markdown 代码块；不要添加 JSON 之外的解释。
        """;

    private static final String SKILL_SYSTEM_PROMPT_EN = """
        You are a skill meta-prompt architect for Agent frameworks such as Claude Code, OpenClaw, and Codex.
        Your job is to turn a vague capability into a SKILL.md that is easier for models to retrieve, invoke, and execute correctly.

        ## Retrieval Mechanics You Must Respect
        Current skill invocation is mostly keyword, tokenization, and stemming based, not semantic-vector retrieval:
        1. Only prompt-type skills that are not disableModelInvocation are indexed.
        2. name is tokenized, stemmed, and additionally split on hyphens/underscores, e.g. create-chart_tool becomes create/chart/tool.
        3. description, whenToUse, and allowedTools are also tokenized and stemmed.
        4. Field weights are roughly: name highest, whenToUse high, description medium, allowedTools low.
        5. Therefore, do not rely on elegant but abstract semantic descriptions. Put realistic user task words, object nouns, synonyms, English terms/acronyms, and boundary terms into name, whenToUse, and description.

        ## Design Principles
        1. skillName should be short, stable, kebab-case, and include the core action plus core object, e.g. create-ppt-outline or debug-sql-query.
        2. whenToUse is the main retrieval surface: include realistic user utterances, trigger scenarios, keywords, synonyms, and adjacent non-trigger boundaries.
        3. description should state what the skill does, what it produces, and its scope in one sentence; avoid marketing copy.
        4. allowedTools should list only tools truly needed for execution; do not rely on it for core retrieval terms because it has low weight.
        5. The SKILL.md body should teach the model how to work: when to use, inputs, workflow, artifacts, quality bar, failures, and boundaries.
        6. If user information is insufficient, generate a usable baseline and list missing details in improvementNotes.

        ## Output Content
        - skillName: optimized directory/skill name.
        - description: short frontmatter description.
        - whenToUse: frontmatter trigger guidance optimized for keyword retrieval.
        - allowedTools: recommended allowed tools.
        - invocationKeywords: retrieval keyword checklist.
        - frontmatterYaml: complete YAML frontmatter.
        - skillMdDraft: draft content that can be saved as SKILL.md.
        - retrievalRationale: why this is easier to retrieve.
        - qualityChecklist: human acceptance checklist.
        - improvementNotes: remaining user inputs or manual checks.

        Return valid JSON only. Do not output Markdown code fences or explanations outside JSON.
        """;
}
