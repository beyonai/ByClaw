package com.iwhalecloud.byai.manager.application.service.aimodel;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelConfigCompleteChange;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelConfigCompleteItem;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelConfigCompleteResponse;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelReasoningConfig;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 模型参数一键完善。
 * <p>
 * 使用默认 LLM 生成建议，并用内置规则兜底。只更新容量、采样和 reasoning/thinking 参数，不修改 URL、modelCode、apiToken、providerName。
 */
@Service
@Slf4j
public class ModelConfigCompleteApplicationService {

    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");

    private static final String MODEL_TYPE_LLM = "LLM";

    @Value("${byai.aimodel.complete.connectTimeoutMs:30000}")
    private int connectTimeoutMs;

    @Value("${byai.aimodel.complete.readTimeoutMs:120000}")
    private int readTimeoutMs;

    @Autowired
    private ByaiAimodelMapper byaiAimodelMapper;

    @Autowired
    private ByaiAimodelDomainService byaiAimodelDomainService;

    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    @Transactional(rollbackFor = Exception.class)
    public ModelConfigCompleteResponse completeAllModelConfig() {
        List<ByaiAimodel> models = byaiAimodelMapper.selectByCondition(null, null, null, null, null, null);
        Map<String, Suggestion> llmSuggestions = loadDefaultLlmSuggestions(models);

        ModelConfigCompleteResponse response = new ModelConfigCompleteResponse();
        response.setTotal(models.size());

        for (ByaiAimodel model : models) {
            ModelConfigCompleteItem item = completeOne(model, llmSuggestions);
            response.getItems().add(item);
            if ("UPDATED".equals(item.getStatus())) {
                response.setUpdated(response.getUpdated() + 1);
            }
            else if ("FAILED".equals(item.getStatus())) {
                response.setFailed(response.getFailed() + 1);
            }
            else {
                response.setSkipped(response.getSkipped() + 1);
            }
        }
        return response;
    }

    private ModelConfigCompleteItem completeOne(ByaiAimodel model, Map<String, Suggestion> llmSuggestions) {
        ModelConfigCompleteItem item = new ModelConfigCompleteItem();
        item.setId(model.getModelId() == null ? null : String.valueOf(model.getModelId()));
        item.setDisplayName(model.getModelName());
        item.setModelCode(model.getModelNo());
        item.setModelType(normalizeModelType(model.getModelType()));

        try {
            Suggestion suggestion = findSuggestion(model, llmSuggestions);
            if (suggestion == null) {
                item.setStatus("SKIPPED");
                item.setSource("NONE");
                item.setConfidence("LOW");
                item.getWarnings().add("未找到可验证的模型参数建议，已跳过");
                return item;
            }

            List<ModelConfigCompleteChange> changes = applySuggestion(model, suggestion);
            item.setChanges(changes);
            item.setSource(suggestion.getSource());
            item.setConfidence(suggestion.getConfidence());
            item.getWarnings().addAll(suggestion.getWarnings());

            if (changes.isEmpty()) {
                item.setStatus("SKIPPED");
                return item;
            }

            byaiAimodelDomainService.upsert(model);
            item.setStatus("UPDATED");
            return item;
        }
        catch (Exception e) {
            log.warn("complete model config fail, modelId={}, modelCode={}", model.getModelId(), model.getModelNo(), e);
            item.setStatus("FAILED");
            item.setSource("NONE");
            item.setConfidence("LOW");
            item.setErrorMessage(e.getMessage());
            return item;
        }
    }

    private List<ModelConfigCompleteChange> applySuggestion(ByaiAimodel model, Suggestion suggestion) {
        List<ModelConfigCompleteChange> changes = new ArrayList<>();

        if (suggestion.getContextTokens() != null && !Objects.equals(model.getMaxContentToken(), suggestion.getContextTokens())) {
            changes.add(new ModelConfigCompleteChange("contextTokens", model.getMaxContentToken(), suggestion.getContextTokens()));
            model.setMaxContentToken(suggestion.getContextTokens());
        }

        JSONObject inParams = parseInParams(model.getInParams());
        putChange(inParams, changes, "maxTokens", suggestion.getMaxTokens());
        putChange(inParams, changes, "temperature", suggestion.getTemperature());
        putChange(inParams, changes, "topP", suggestion.getTopP());
        putChange(inParams, changes, "frequencyPenalty", suggestion.getFrequencyPenalty());
        putChange(inParams, changes, "presencePenalty", suggestion.getPresencePenalty());
        if (suggestion.getReasoningConfig() != null) {
            JSONObject nextReasoning = JSONObject.parseObject(JsonUtil.toJSONString(suggestion.getReasoningConfig()));
            Object before = inParams.get("reasoningConfig");
            if (!jsonEquals(before, nextReasoning)) {
                changes.add(new ModelConfigCompleteChange("reasoningConfig", before, nextReasoning));
                inParams.put("reasoningConfig", nextReasoning);
            }
        }
        if (!changes.isEmpty()) {
            model.setInParams(inParams.toJSONString());
        }
        return changes;
    }

    private void putChange(JSONObject inParams, List<ModelConfigCompleteChange> changes, String field, Object value) {
        if (value == null) {
            return;
        }
        Object before = inParams.get(field);
        if (jsonEquals(before, value)) {
            return;
        }
        changes.add(new ModelConfigCompleteChange(field, before, value));
        inParams.put(field, value);
    }

    private boolean jsonEquals(Object left, Object right) {
        if (left == right) {
            return true;
        }
        if (left == null || right == null) {
            return false;
        }
        return JsonUtil.toJSONString(left).equals(JsonUtil.toJSONString(right));
    }

    private Suggestion findSuggestion(ByaiAimodel model, Map<String, Suggestion> llmSuggestions) {
        String key = normalizeCode(model.getModelNo());
        Suggestion llm = llmSuggestions.get(key);
        Suggestion builtin = builtinSuggestion(model);
        if (llm == null) {
            return builtin;
        }
        Suggestion sanitized = sanitizeSuggestion(model, llm);
        if (sanitized == null) {
            return builtin;
        }
        if (builtin != null) {
            mergeMissing(sanitized, builtin);
        }
        return sanitized;
    }

    private void mergeMissing(Suggestion target, Suggestion fallback) {
        if (target.getContextTokens() == null) {
            target.setContextTokens(fallback.getContextTokens());
        }
        if (target.getMaxTokens() == null) {
            target.setMaxTokens(fallback.getMaxTokens());
        }
        if (target.getReasoningConfig() == null) {
            target.setReasoningConfig(fallback.getReasoningConfig());
        }
        if (target.getTemperature() == null) {
            target.setTemperature(fallback.getTemperature());
        }
        if (target.getTopP() == null) {
            target.setTopP(fallback.getTopP());
        }
        if (target.getFrequencyPenalty() == null) {
            target.setFrequencyPenalty(fallback.getFrequencyPenalty());
        }
        if (target.getPresencePenalty() == null) {
            target.setPresencePenalty(fallback.getPresencePenalty());
        }
    }

    private Suggestion sanitizeSuggestion(ByaiAimodel model, Suggestion raw) {
        if (raw == null) {
            return null;
        }
        Suggestion suggestion = raw.copy();
        suggestion.setSource("DEFAULT_LLM");
        if (!List.of("HIGH", "MEDIUM", "LOW").contains(nullToDefault(suggestion.getConfidence(), "LOW"))) {
            suggestion.setConfidence("LOW");
        }
        if (suggestion.getContextTokens() != null && suggestion.getContextTokens() < 1000) {
            suggestion.getWarnings().add("默认 LLM 返回的 contextTokens 小于 1000，已忽略");
            suggestion.setContextTokens(null);
        }
        if (suggestion.getMaxTokens() != null && suggestion.getMaxTokens() < 1) {
            suggestion.getWarnings().add("默认 LLM 返回的 maxTokens 小于 1，已忽略");
            suggestion.setMaxTokens(null);
        }
        if (!MODEL_TYPE_LLM.equals(normalizeModelType(model.getModelType()))) {
            suggestion.setReasoningConfig(null);
        }
        return suggestion.getContextTokens() == null && suggestion.getMaxTokens() == null
            && suggestion.getReasoningConfig() == null ? null : suggestion;
    }

    private Map<String, Suggestion> loadDefaultLlmSuggestions(List<ByaiAimodel> models) {
        try {
            String defaultModelId = modelManagementApplicationService.getDefaultModelId(MODEL_TYPE_LLM);
            Long modelId = Long.valueOf(defaultModelId);
            ByaiAimodel defaultModel = byaiAimodelDomainService.getById(modelId);
            if (defaultModel == null || StringUtil.isEmpty(defaultModel.getAuthToken())) {
                return Map.of();
            }
            String token = decryptTokenSafely(defaultModel.getAuthToken());
            if (StringUtil.isEmpty(token)) {
                return Map.of();
            }
            String prompt = buildCompletionPrompt(models);
            String content = callDefaultLlm(defaultModel, token, prompt);
            return parseSuggestions(content);
        }
        catch (Exception e) {
            log.warn("default LLM model config completion failed, fallback to builtin registry: {}", e.getMessage());
            return Map.of();
        }
    }

    private String callDefaultLlm(ByaiAimodel defaultModel, String token, String prompt) throws Exception {
        JSONObject body = new JSONObject(true);
        body.put("model", defaultModel.getModelNo());
        JSONArray messages = new JSONArray();
        messages.add(message("system", "你是模型能力配置分析器。必须返回严格 JSON，不要输出 Markdown。"));
        messages.add(message("user", prompt));
        body.put("messages", messages);
        body.put("temperature", 0);
        body.put("max_tokens", 4096);

        Request.Builder builder = new Request.Builder()
            .url(resolveChatCompletionsUrl(defaultModel.getUrl()))
            .post(RequestBody.create(body.toJSONString(), JSON_MEDIA_TYPE))
            .addHeader("Content-Type", "application/json")
            .addHeader("Authorization", "Bearer " + token);
        appendExtraHeaders(defaultModel, builder);

        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(connectTimeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS)
            .build();
        try (Response response = client.newCall(builder.build()).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IllegalStateException("default LLM HTTP " + response.code());
            }
            JSONObject json = JSONObject.parseObject(responseBody);
            if (json == null) {
                throw new IllegalStateException("default LLM returned invalid JSON");
            }
            String content = Optional.ofNullable(json.getJSONArray("choices"))
                .filter(arr -> !arr.isEmpty())
                .map(arr -> arr.getJSONObject(0))
                .map(choice -> choice.getJSONObject("message"))
                .map(message -> message.getString("content"))
                .orElse(null);
            if (StringUtil.isEmpty(content)) {
                throw new IllegalStateException("default LLM returned empty content");
            }
            return content;
        }
    }

    private JSONObject message(String role, String content) {
        JSONObject message = new JSONObject(true);
        message.put("role", role);
        message.put("content", content);
        return message;
    }

    private void appendExtraHeaders(ByaiAimodel defaultModel, Request.Builder builder) {
        JSONObject inParams = parseInParams(defaultModel.getInParams());
        JSONArray headers = inParams.getJSONArray("headers");
        if (headers == null) {
            return;
        }
        for (int i = 0; i < headers.size(); i++) {
            JSONObject item = headers.getJSONObject(i);
            String key = item.getString("key");
            String value = item.getString("value");
            if (StringUtil.isEmpty(key) || StringUtil.isEmpty(value) || "authorization".equalsIgnoreCase(key.trim())) {
                continue;
            }
            builder.addHeader(key.trim(), value);
        }
    }

    private String resolveChatCompletionsUrl(String baseUrl) {
        String url = nullToDefault(baseUrl, "").trim();
        if (url.endsWith("/chat/completions")) {
            return url;
        }
        url = url.replaceAll("/+$", "");
        return url + "/chat/completions";
    }

    private String buildCompletionPrompt(List<ByaiAimodel> models) {
        JSONArray arr = new JSONArray();
        for (ByaiAimodel model : models) {
            JSONObject item = new JSONObject(true);
            item.put("id", model.getModelId() == null ? null : String.valueOf(model.getModelId()));
            item.put("displayName", model.getModelName());
            item.put("modelCode", model.getModelNo());
            item.put("modelType", normalizeModelType(model.getModelType()));
            item.put("providerName", parseInParams(model.getInParams()).getString("providerName"));
            item.put("modelProtocol", parseInParams(model.getInParams()).getString("modelProtocol"));
            arr.add(item);
        }
        return """
            请联网查询这些模型的官方或供应商公开文档，补齐模型配置参数。
            只能返回 JSON 对象，格式如下：
            {
              "suggestions": [
                {
                  "modelCode": "xxx",
                  "contextTokens": 1000000,
                  "maxTokens": 65536,
                  "temperature": 0.7,
                  "topP": 0.95,
                  "frequencyPenalty": 0,
                  "presencePenalty": 0,
                  "reasoningConfig": {
                    "enabled": true,
                    "defaultLevel": "high",
                    "capability": "effort",
                    "compatFormat": "deepseek",
                    "supportedEfforts": ["low","medium","high"],
                    "effortMap": {"low":"high","medium":"high","high":"high","xhigh":"max","max":"max"},
                    "budgets": {"high": 16384}
                  },
                  "confidence": "HIGH",
                  "warnings": []
                }
              ]
            }
            规则：
            1. 不要返回 Markdown，不要解释。
            2. 不要改 URL、modelCode、apiKey、供应商。
            3. 未披露的字段不要猜测，confidence=LOW 并写 warnings。
            4. EMBEDDING/RERANK 不要启用 reasoningConfig。
            5. contextTokens 是上下文窗口，maxTokens 是单次最大输出，不要混淆。
            模型列表：
            """ + arr.toJSONString();
    }

    private Map<String, Suggestion> parseSuggestions(String content) {
        String jsonText = extractJson(content);
        JSONObject root = JSONObject.parseObject(jsonText);
        JSONArray arr = root.getJSONArray("suggestions");
        if (arr == null) {
            return Map.of();
        }
        Map<String, Suggestion> out = new HashMap<>();
        for (int i = 0; i < arr.size(); i++) {
            JSONObject obj = arr.getJSONObject(i);
            String modelCode = obj.getString("modelCode");
            if (StringUtil.isEmpty(modelCode)) {
                continue;
            }
            Suggestion suggestion = new Suggestion();
            suggestion.setContextTokens(obj.getInteger("contextTokens"));
            suggestion.setMaxTokens(obj.getInteger("maxTokens"));
            suggestion.setTemperature(obj.getDouble("temperature"));
            suggestion.setTopP(obj.getDouble("topP"));
            suggestion.setFrequencyPenalty(obj.getDouble("frequencyPenalty"));
            suggestion.setPresencePenalty(obj.getDouble("presencePenalty"));
            suggestion.setConfidence(nullToDefault(obj.getString("confidence"), "LOW"));
            suggestion.setSource("DEFAULT_LLM");
            suggestion.setReasoningConfig(parseReasoningConfig(obj.getJSONObject("reasoningConfig")));
            JSONArray warnings = obj.getJSONArray("warnings");
            if (warnings != null) {
                for (Object warning : warnings) {
                    suggestion.getWarnings().add(String.valueOf(warning));
                }
            }
            out.put(normalizeCode(modelCode), suggestion);
        }
        return out;
    }

    private String extractJson(String text) {
        String value = nullToDefault(text, "").trim();
        if (value.startsWith("```")) {
            value = value.replaceFirst("^```[a-zA-Z]*\\s*", "");
            value = value.replaceFirst("\\s*```$", "");
        }
        int start = value.indexOf('{');
        int end = value.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return value.substring(start, end + 1);
        }
        return value;
    }

    private Suggestion builtinSuggestion(ByaiAimodel model) {
        String code = normalizeCode(model.getModelNo());
        String type = normalizeModelType(model.getModelType());
        if ("EMBEDDING".equals(type) && code.contains("text-embedding-v4")) {
            return base(8192, 8192, null, "BUILTIN_REGISTRY", "HIGH");
        }
        if (!MODEL_TYPE_LLM.equals(type)) {
            return null;
        }
        if (code.contains("minimax-m3")) {
            return base(1000000, 524288, adaptive("auto"), "BUILTIN_REGISTRY", "HIGH");
        }
        if (code.contains("minimax-m2.7")) {
            return base(204800, 204800, binary("auto"), "BUILTIN_REGISTRY", "HIGH");
        }
        if (code.contains("kimi-k2.6") || code.contains("kimi-k2.5")) {
            return base(262144, 32768, binary("anthropic"), "BUILTIN_REGISTRY", "HIGH");
        }
        if (code.contains("qwen3.6") || code.contains("qwen3.7")) {
            return base(1000000, 65536, budget("qwen"), "BUILTIN_REGISTRY", "HIGH");
        }
        if (code.contains("deepseek-v4")) {
            Suggestion suggestion = base(1000000, 384000, effort("deepseek"), "BUILTIN_REGISTRY", "HIGH");
            suggestion.getReasoningConfig().setDefaultLevel("max");
            suggestion.getReasoningConfig().setSupportedEfforts(List.of("high", "max"));
            suggestion.getReasoningConfig().setEffortMap(Map.of(
                "low", "high", "medium", "high", "high", "high", "xhigh", "max", "max", "max"));
            return suggestion;
        }
        if (code.contains("glm-5.1")) {
            return base(200000, 131072, effort("zai"), "BUILTIN_REGISTRY", "HIGH");
        }
        return null;
    }

    private Suggestion base(Integer contextTokens, Integer maxTokens, ModelReasoningConfig reasoningConfig,
        String source, String confidence) {
        Suggestion suggestion = new Suggestion();
        suggestion.setContextTokens(contextTokens);
        suggestion.setMaxTokens(maxTokens);
        suggestion.setTemperature(0.7);
        suggestion.setTopP(0.95);
        suggestion.setFrequencyPenalty(0D);
        suggestion.setPresencePenalty(0D);
        suggestion.setReasoningConfig(reasoningConfig);
        suggestion.setSource(source);
        suggestion.setConfidence(confidence);
        return suggestion;
    }

    private ModelReasoningConfig binary(String compatFormat) {
        ModelReasoningConfig config = new ModelReasoningConfig();
        config.setEnabled(true);
        config.setCapability("binary");
        config.setDefaultLevel("high");
        config.setCompatFormat(compatFormat);
        config.setSupportedEfforts(List.of("high"));
        return config;
    }

    private ModelReasoningConfig adaptive(String compatFormat) {
        ModelReasoningConfig config = new ModelReasoningConfig();
        config.setEnabled(true);
        config.setCapability("adaptive");
        config.setDefaultLevel("adaptive");
        config.setCompatFormat(compatFormat);
        config.setSupportedEfforts(List.of("adaptive", "high"));
        return config;
    }

    private ModelReasoningConfig effort(String compatFormat) {
        ModelReasoningConfig config = new ModelReasoningConfig();
        config.setEnabled(true);
        config.setCapability("effort");
        config.setDefaultLevel("high");
        config.setCompatFormat(compatFormat);
        config.setSupportedEfforts(List.of("low", "medium", "high"));
        config.setEffortMap(Map.of(
            "minimal", "low", "low", "low", "medium", "medium", "high", "high", "xhigh", "high", "max", "high"));
        return config;
    }

    private ModelReasoningConfig budget(String compatFormat) {
        ModelReasoningConfig config = new ModelReasoningConfig();
        config.setEnabled(true);
        config.setCapability("budget");
        config.setDefaultLevel("high");
        config.setCompatFormat(compatFormat);
        config.setSupportedEfforts(List.of("minimal", "low", "medium", "high", "max"));
        Map<String, Integer> budgets = new LinkedHashMap<>();
        budgets.put("minimal", 1024);
        budgets.put("low", 4096);
        budgets.put("medium", 8192);
        budgets.put("high", 16384);
        budgets.put("max", 32768);
        config.setBudgets(budgets);
        return config;
    }

    private ModelReasoningConfig parseReasoningConfig(JSONObject obj) {
        if (obj == null || obj.isEmpty()) {
            return null;
        }
        return JSON.parseObject(obj.toJSONString(), ModelReasoningConfig.class);
    }

    private JSONObject parseInParams(String text) {
        if (StringUtil.isEmpty(text)) {
            return new JSONObject(true);
        }
        try {
            JSONObject obj = JSONObject.parseObject(text);
            return obj == null ? new JSONObject(true) : obj;
        }
        catch (Exception e) {
            return new JSONObject(true);
        }
    }

    private String decryptTokenSafely(String encrypted) {
        if (StringUtil.isEmpty(encrypted)) {
            return encrypted;
        }
        try {
            return Sm4Util.decrypt(encrypted);
        }
        catch (Exception e) {
            return encrypted;
        }
    }

    private String normalizeCode(String code) {
        return nullToDefault(code, "").trim().toLowerCase(Locale.ROOT);
    }

    private String normalizeModelType(String modelType) {
        String value = nullToDefault(modelType, MODEL_TYPE_LLM).trim();
        if ("1".equals(value)) {
            return MODEL_TYPE_LLM;
        }
        if ("2".equals(value)) {
            return "RERANK";
        }
        return value.toUpperCase(Locale.ROOT);
    }

    private String nullToDefault(String value, String defaultValue) {
        return value == null ? defaultValue : value;
    }

    @Data
    private static class Suggestion {
        private Integer contextTokens;
        private Integer maxTokens;
        private Double temperature;
        private Double topP;
        private Double frequencyPenalty;
        private Double presencePenalty;
        private ModelReasoningConfig reasoningConfig;
        private String source = "NONE";
        private String confidence = "LOW";
        private List<String> warnings = new ArrayList<>();

        private Suggestion copy() {
            Suggestion copy = new Suggestion();
            copy.setContextTokens(contextTokens);
            copy.setMaxTokens(maxTokens);
            copy.setTemperature(temperature);
            copy.setTopP(topP);
            copy.setFrequencyPenalty(frequencyPenalty);
            copy.setPresencePenalty(presencePenalty);
            copy.setReasoningConfig(reasoningConfig);
            copy.setSource(source);
            copy.setConfidence(confidence);
            copy.setWarnings(new ArrayList<>(CollectionUtils.isEmpty(warnings) ? List.of() : warnings));
            return copy;
        }
    }
}
