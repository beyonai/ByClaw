package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import okhttp3.sse.EventSources;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * OpenAI服务实现 直接使用OpenAI API规范
 */
@Service
public class AIService {

    private static final String FINAL_JSON_ONLY_INSTRUCTION =
        "Do not output analysis, reasoning, or <think> blocks. Return only the final JSON object.";

    @Autowired
    private AiModelService aiModelService;

    private final RestTemplate restTemplate = new RestTemplate();

    private final ObjectMapper objectMapper = new ObjectMapper();

    private ModelDto getDefaultModel() {
        ModelDto defaultModel = aiModelService.getDefaultChatModel();
        if (defaultModel == null) {
            throw new BdpRuntimeException(I18nUtil.get("ai.service.no.default.model.found"));
        }
        return defaultModel;
    }

    public String generateText(String prompt, String modelCode) {
        return generateText(null, prompt, modelCode, 4000);
    }

    public String generateText(String systemPrompt, String userPrompt, String modelCode, int maxTokens) {
        ModelDto defaultModel = getDefaultModel();
        return generateText(systemPrompt, userPrompt, defaultModel, modelCode, maxTokens);
    }

    /**
     * Uses a model resolved by a caller that owns the model-selection policy.
     *
     * <p>The recorder uses this overload after resolving the configured default through model management, so its
     * request path does not depend on the Redis model cache.</p>
     */
    public String generateText(String systemPrompt, String userPrompt, ModelDto model, int maxTokens) {
        return generateText(systemPrompt, userPrompt, model, null, maxTokens, false).content();
    }

    /**
     * Requests OpenAI-compatible JSON-object output for callers that require machine-readable results.
     */
    public String generateJsonObject(String systemPrompt, String userPrompt, ModelDto model, int maxTokens) {
        return generateJsonObjectWithMetadata(systemPrompt, userPrompt, model, maxTokens).content();
    }

    /**
     * Requests a JSON object and preserves the upstream completion reason for operational diagnostics.
     */
    public GeneratedText generateJsonObjectWithMetadata(String systemPrompt, String userPrompt, ModelDto model, int maxTokens) {
        return generateText(systemPrompt, userPrompt, model, null, maxTokens, true);
    }

    private String generateText(
        String systemPrompt,
        String userPrompt,
        ModelDto defaultModel,
        String modelCode,
        int maxTokens
    ) {
        return generateText(systemPrompt, userPrompt, defaultModel, modelCode, maxTokens, false).content();
    }

    private GeneratedText generateText(
        String systemPrompt,
        String userPrompt,
        ModelDto defaultModel,
        String modelCode,
        int maxTokens,
        boolean jsonObject
    ) {
        String apiUrl = defaultModel.getUrl() + "/chat/completions";
        String apiKey = defaultModel.getAuthToken();
        String model = defaultModel.getModelCode();
        if (StringUtils.isNotBlank(modelCode)) {
            model = modelCode;
        }
        try {
            // 构造请求体
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("model", model);

            JsonGenerationPolicy jsonPolicy = jsonObject
                ? resolveJsonGenerationPolicy(defaultModel, model)
                : JsonGenerationPolicy.notApplicable();
            String effectiveUserPrompt = jsonPolicy.promptFallback()
                ? userPrompt + "\n\n" + FINAL_JSON_ONLY_INSTRUCTION
                : userPrompt;

            List<Map<String, String>> messages = new ArrayList<>();
            if (StringUtils.isNotBlank(systemPrompt)) {
                messages.add(Map.of("role", "system", "content", systemPrompt));
            }
            messages.add(Map.of("role", "user", "content", effectiveUserPrompt));
            requestBody.put("messages", messages);

            requestBody.put("temperature", jsonObject ? jsonPolicy.temperature() : 0.7);
            requestBody.put("max_tokens", maxTokens > 0 ? maxTokens : 4000);
            if (jsonObject) {
                requestBody.put("response_format", Map.of("type", "json_object"));
                requestBody.putAll(jsonPolicy.requestParams());
            } else {
                applyThinkingParams(requestBody, defaultModel);
            }

            // 设置请求头
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
            headers.set("Authorization", "Bearer " + apiKey);
            headers.set("X-CHANNEL", "BYAI");

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

            // 发送请求
            ResponseEntity<String> response = restTemplate.postForEntity(apiUrl, entity, String.class);

            // 解析响应
            if (response.getStatusCode() == HttpStatus.OK) {
                Map<String, Object> responseMap = objectMapper.readValue(response.getBody(), Map.class);
                List<Map<String, Object>> choices = (List<Map<String, Object>>) responseMap.get("choices");
                if (choices != null && !choices.isEmpty()) {
                    Map<String, Object> firstChoice = choices.get(0);
                    Map<String, Object> message = (Map<String, Object>) firstChoice.get("message");
                    Object finishReason = firstChoice.get("finish_reason");
                    return new GeneratedText(
                        message == null || message.get("content") == null ? null : String.valueOf(message.get("content")),
                        finishReason instanceof String ? (String) finishReason : null
                    );
                }
            }
            throw new BaseException(I18nUtil.get("ai.openai.api.request.failed", response.getStatusCode()));
        } catch (Exception e) {
            throw new BaseException(I18nUtil.get("ai.openai.api.call.failed", e.getMessage()), e);
        }
    }

    public String generateTextStream(String systemPrompt, String userPrompt, String modelCode, int maxTokens,
                                     TextChunkHandler chunkHandler) {
        ModelDto defaultModel = getDefaultModel();
        String apiUrl = defaultModel.getUrl() + "/chat/completions";
        String apiKey = defaultModel.getAuthToken();
        String model = defaultModel.getModelCode();
        if (StringUtils.isNotBlank(modelCode)) {
            model = modelCode;
        }
        try {
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("model", model);

            List<Map<String, String>> messages = new ArrayList<>();
            if (StringUtils.isNotBlank(systemPrompt)) {
                messages.add(Map.of("role", "system", "content", systemPrompt));
            }
            messages.add(Map.of("role", "user", "content", userPrompt));
            requestBody.put("messages", messages);

            requestBody.put("temperature", 0.7);
            requestBody.put("max_tokens", maxTokens > 0 ? maxTokens : 4000);
            requestBody.put("stream", true);
            applyThinkingParams(requestBody, defaultModel);

            StringBuilder fullContent = new StringBuilder();
            CountDownLatch doneLatch = new CountDownLatch(1);
            AtomicReference<Throwable> errorRef = new AtomicReference<>();
            AtomicReference<EventSource> eventSourceRef = new AtomicReference<>();

            MediaType json = MediaType.get("application/json; charset=utf-8");
            RequestBody requestBodyJson = RequestBody.create(objectMapper.writeValueAsString(requestBody), json);
            Request request = new Request.Builder()
                .url(apiUrl)
                .post(requestBodyJson)
                .addHeader("Accept", "text/event-stream")
                .addHeader("Content-Type", "application/json")
                .addHeader("Authorization", "Bearer " + apiKey)
                .addHeader("X-CHANNEL", "BYAI")
                .build();

            OkHttpClient client = OkHttpUtil.getHttpClient();
            EventSource eventSource = EventSources.createFactory(client).newEventSource(request,
                new EventSourceListener() {
                    @Override
                    public void onEvent(EventSource eventSource, String id, String type, String data) {
                        if ("[DONE]".equals(data)) {
                            doneLatch.countDown();
                            eventSource.cancel();
                            return;
                        }
                        try {
                            String chunk = extractStreamChunk(data);
                            if (StringUtils.isNotEmpty(chunk)) {
                                fullContent.append(chunk);
                                if (chunkHandler != null) {
                                    chunkHandler.onChunk(chunk);
                                }
                            }
                        } catch (Exception e) {
                            errorRef.compareAndSet(null, e);
                            doneLatch.countDown();
                            eventSource.cancel();
                        }
                    }

                    @Override
                    public void onClosed(EventSource eventSource) {
                        doneLatch.countDown();
                    }

                    @Override
                    public void onFailure(EventSource eventSource, Throwable t, Response response) {
                        errorRef.compareAndSet(null, buildStreamFailure(t, response));
                        doneLatch.countDown();
                    }
                });
            eventSourceRef.set(eventSource);

            boolean completed = doneLatch.await(10, TimeUnit.MINUTES);
            if (!completed) {
                EventSource source = eventSourceRef.get();
                if (source != null) {
                    source.cancel();
                }
                throw new BaseException(I18nUtil.get("ai.openai.api.call.failed", "stream timeout"));
            }
            Throwable error = errorRef.get();
            if (error != null) {
                throw new BaseException(I18nUtil.get("ai.openai.api.call.failed", error.getMessage()), error);
            }
            return fullContent.toString();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BaseException(I18nUtil.get("ai.openai.api.call.failed", e.getMessage()), e);
        } catch (Exception e) {
            throw new BaseException(I18nUtil.get("ai.openai.api.call.failed", e.getMessage()), e);
        }
    }

    private RuntimeException buildStreamFailure(Throwable t, Response response) {
        String message = t != null ? t.getMessage() : "";
        if (response != null) {
            message = "HTTP " + response.code();
        }
        return new RuntimeException(StringUtils.defaultIfBlank(message, "stream failed"), t);
    }

    @SuppressWarnings("unchecked")
    private String extractStreamChunk(String data) throws IOException {
        Map<String, Object> responseMap = objectMapper.readValue(data, Map.class);
        List<Map<String, Object>> choices = (List<Map<String, Object>>) responseMap.get("choices");
        if (choices == null || choices.isEmpty()) {
            return "";
        }
        Map<String, Object> firstChoice = choices.get(0);
        Object deltaObject = firstChoice.get("delta");
        if (deltaObject instanceof Map<?, ?> delta) {
            Object content = delta.get("content");
            return content != null ? String.valueOf(content) : "";
        }
        Object messageObject = firstChoice.get("message");
        if (messageObject instanceof Map<?, ?> message) {
            Object content = message.get("content");
            return content != null ? String.valueOf(content) : "";
        }
        return "";
    }

    @FunctionalInterface
    public interface TextChunkHandler {
        void onChunk(String chunk) throws IOException;
    }

    public record GeneratedText(String content, String finishReason) {
    }

    private JsonGenerationPolicy resolveJsonGenerationPolicy(ModelDto modelDto, String requestedModel) {
        String provider = resolveProvider(modelDto);
        String model = normalizeString(requestedModel, "");

        if (provider.contains("openrouter")) {
            if (isMandatoryOpenRouterReasoningModel(model)) {
                return JsonGenerationPolicy.fallback(Map.of("reasoning", Map.of("exclude", true)), 0.0);
            }
            return JsonGenerationPolicy.withParams(
                Map.of("reasoning", Map.of("effort", "none", "exclude", true)), 0.0
            );
        }
        if (provider.contains("together")) {
            if (isExplicitThinkingOnlyModel(model)) {
                return JsonGenerationPolicy.fallback(Map.of(), 0.0);
            }
            return JsonGenerationPolicy.withParams(Map.of("reasoning", Map.of("enabled", false)), 0.0);
        }
        if (isProviderOrUnambiguousModel(provider, model, "deepseek", "deepseek")) {
            if (model.contains("r1")) {
                return JsonGenerationPolicy.fallback(Map.of(), 0.0);
            }
            return JsonGenerationPolicy.withParams(Map.of("thinking", Map.of("type", "disabled")), 0.0);
        }
        if (isProviderOrUnambiguousModel(provider, model, "minimax", "minimax")) {
            if (model.contains("m3")) {
                return JsonGenerationPolicy.withParams(Map.of("thinking", Map.of("type", "disabled")), 0.1);
            }
            if (model.contains("m2")) {
                return JsonGenerationPolicy.fallback(Map.of("reasoning_split", true), 0.1);
            }
            return JsonGenerationPolicy.fallback(Map.of(), 0.1);
        }
        if (isQwenProvider(provider, model)) {
            if (isExplicitThinkingOnlyModel(model)) {
                return JsonGenerationPolicy.fallback(Map.of(), 0.0);
            }
            return JsonGenerationPolicy.withParams(Map.of("enable_thinking", false), 0.0);
        }
        if (isZaiProvider(provider, model)) {
            if (supportsZaiThinkingSwitch(model)) {
                return JsonGenerationPolicy.withParams(Map.of("thinking", Map.of("type", "disabled")), 0.0);
            }
            return JsonGenerationPolicy.withParams(Map.of(), 0.0);
        }
        if (isGoogleProvider(provider, model)) {
            if (model.contains("gemini-2.5-flash") || model.contains("gemini-2.5-flash-lite")) {
                return JsonGenerationPolicy.withParams(Map.of("reasoning_effort", "none"), 1.0);
            }
            if (model.contains("gemini-2.5-pro") || model.contains("gemini-3")) {
                return JsonGenerationPolicy.fallback(Map.of("reasoning_effort", "low"), 1.0);
            }
            return JsonGenerationPolicy.fallback(Map.of(), 1.0);
        }
        if (isOpenAiProvider(provider, model)) {
            if (supportsOpenAiNoReasoning(model)) {
                return JsonGenerationPolicy.withParams(Map.of("reasoning_effort", "none"), 0.0);
            }
            if (isOpenAiReasoningModel(model)) {
                return JsonGenerationPolicy.fallback(Map.of(), 0.0);
            }
            return JsonGenerationPolicy.withParams(Map.of(), 0.0);
        }
        if (provider.contains("anthropic") || provider.contains("claude")) {
            // Native Claude requests disable thinking by omitting the optional thinking object. An OpenAI-compatible
            // proxy has no portable equivalent, so keep the request parameter-free and reinforce the output contract.
            return JsonGenerationPolicy.fallback(Map.of(), 0.0);
        }
        return JsonGenerationPolicy.fallback(Map.of(), 0.0);
    }

    private String resolveProvider(ModelDto modelDto) {
        if (StringUtils.isNotBlank(modelDto.getProviderName())) {
            return normalizeString(modelDto.getProviderName(), "");
        }
        Map<String, Object> instanceParam = modelDto.getInstanceParam();
        if (instanceParam != null && instanceParam.get("providerName") != null) {
            return normalizeString(instanceParam.get("providerName"), "");
        }
        if (instanceParam != null && instanceParam.get("reasoningConfig") instanceof Map<?, ?> config) {
            Object compatFormat = config.get("compatFormat");
            if (compatFormat != null) {
                return normalizeString(compatFormat, "");
            }
        }
        return "";
    }

    private boolean isProviderOrUnambiguousModel(String provider, String model, String providerToken,
                                                 String modelToken) {
        return provider.contains(providerToken) || model.contains(modelToken);
    }

    private boolean isQwenProvider(String provider, String model) {
        return provider.contains("qwen") || provider.contains("alibaba") || provider.contains("dashscope")
            || provider.contains("aliyun") || model.contains("qwen");
    }

    private boolean isZaiProvider(String provider, String model) {
        return provider.equals("zai") || provider.contains("z.ai") || provider.contains("zhipu")
            || provider.contains("智谱") || model.startsWith("glm-");
    }

    private boolean isGoogleProvider(String provider, String model) {
        return provider.contains("google") || provider.contains("gemini")
            || model.startsWith("gemini-");
    }

    private boolean isOpenAiProvider(String provider, String model) {
        return provider.contains("openai") || (provider.isEmpty() && (model.startsWith("gpt-") || model.matches("o\\d.*")));
    }

    private boolean supportsZaiThinkingSwitch(String model) {
        return model.startsWith("glm-5") || model.startsWith("glm-4.5") || model.startsWith("glm-4.6")
            || model.startsWith("glm-4.7");
    }

    private boolean supportsOpenAiNoReasoning(String model) {
        if (model.contains("-pro")) {
            return false;
        }
        return model.startsWith("gpt-5.1") || model.startsWith("gpt-5.2") || model.startsWith("gpt-5.3")
            || model.startsWith("gpt-5.4") || model.startsWith("gpt-5.5") || model.startsWith("gpt-5.6")
            || model.startsWith("gpt-5.7") || model.startsWith("gpt-5.8") || model.startsWith("gpt-5.9")
            || model.startsWith("gpt-6");
    }

    private boolean isOpenAiReasoningModel(String model) {
        return model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")
            || model.equals("gpt-5") || model.startsWith("gpt-5-");
    }

    private boolean isMandatoryOpenRouterReasoningModel(String model) {
        return model.equals("openrouter/auto") || model.equals("openrouter/free") || model.contains("gemini-3")
            || model.contains("gemini-2.5-pro") || model.contains("deepseek-r1")
            || isExplicitThinkingOnlyModel(model);
    }

    private boolean isExplicitThinkingOnlyModel(String model) {
        return model.contains("-thinking") || model.startsWith("qwq") || model.contains("/qwq")
            || model.contains("reasoning-only");
    }

    private record JsonGenerationPolicy(Map<String, Object> requestParams, double temperature,
                                        boolean promptFallback) {
        static JsonGenerationPolicy withParams(Map<String, Object> requestParams, double temperature) {
            return new JsonGenerationPolicy(requestParams, temperature, false);
        }

        static JsonGenerationPolicy fallback(Map<String, Object> requestParams, double temperature) {
            return new JsonGenerationPolicy(requestParams, temperature, true);
        }

        static JsonGenerationPolicy notApplicable() {
            return withParams(Map.of(), 0.7);
        }
    }

    @SuppressWarnings("unchecked")
    private void applyThinkingParams(Map<String, Object> requestBody, ModelDto modelDto) {
        Map<String, Object> instanceParam = modelDto.getInstanceParam();
        Object rawConfig = instanceParam != null ? instanceParam.get("reasoningConfig") : null;
        Map<String, Object> reasoningConfig =
            rawConfig instanceof Map ? (Map<String, Object>) rawConfig : new HashMap<>();
        boolean enabled = Boolean.TRUE.equals(reasoningConfig.get("enabled"));
        String capability = normalizeString(reasoningConfig.get("capability"), "unsupported");
        String defaultLevel = normalizeString(reasoningConfig.get("defaultLevel"), "off");
        if (!enabled || "unsupported".equals(capability) || "off".equals(defaultLevel)) {
            requestBody.put("enable_thinking", false);
            requestBody.put("chat_template_kwargs", Map.of("enable_thinking", false));
            return;
        }

        String compatFormat = normalizeString(reasoningConfig.get("compatFormat"), "auto");
        switch (compatFormat) {
            case "deepseek":
            case "openai":
            case "openrouter":
            case "zai":
                requestBody.put("reasoning_effort", resolveReasoningEffort(reasoningConfig, defaultLevel));
                break;
            case "together":
                requestBody.put("reasoning", Map.of("enabled", true));
                break;
            case "qwen":
                requestBody.put("enable_thinking", true);
                putThinkingBudget(requestBody, reasoningConfig, defaultLevel);
                break;
            case "qwen-chat-template":
                requestBody.put("chat_template_kwargs", Map.of("enable_thinking", true));
                putThinkingBudget(requestBody, reasoningConfig, defaultLevel);
                break;
            case "anthropic":
                if ("adaptive".equals(defaultLevel)) {
                    requestBody.put("thinking", Map.of("type", "adaptive", "display", "summarized"));
                } else {
                    Object budget = getThinkingBudget(reasoningConfig, defaultLevel);
                    requestBody.put("thinking",
                        budget instanceof Number ? Map.of("type", "enabled", "budget_tokens", budget)
                            : Map.of("type", "enabled"));
                }
                break;
            default:
                requestBody.put("enable_thinking", true);
                requestBody.put("chat_template_kwargs", Map.of("enable_thinking", true));
                break;
        }
    }

    @SuppressWarnings("unchecked")
    private String resolveReasoningEffort(Map<String, Object> reasoningConfig, String defaultLevel) {
        Object rawMap = reasoningConfig.get("effortMap");
        if (rawMap instanceof Map) {
            Object mapped = ((Map<String, Object>) rawMap).get(defaultLevel);
            if (mapped != null && StringUtils.isNotBlank(String.valueOf(mapped))) {
                return String.valueOf(mapped).trim();
            }
        }
        if ("minimal".equals(defaultLevel) || "low".equals(defaultLevel) || "medium".equals(defaultLevel)) {
            return "high";
        }
        if ("adaptive".equals(defaultLevel)) {
            return "medium";
        }
        if ("xhigh".equals(defaultLevel) || "max".equals(defaultLevel)) {
            return "max";
        }
        return defaultLevel;
    }

    @SuppressWarnings("unchecked")
    private void putThinkingBudget(Map<String, Object> requestBody, Map<String, Object> reasoningConfig,
                                   String defaultLevel) {
        Object rawBudgets = reasoningConfig.get("budgets");
        if (!(rawBudgets instanceof Map)) {
            return;
        }
        Object budget = ((Map<String, Object>) rawBudgets).get(defaultLevel);
        if (budget instanceof Number) {
            requestBody.put("thinking_budget", ((Number) budget).intValue());
        }
    }

    @SuppressWarnings("unchecked")
    private Object getThinkingBudget(Map<String, Object> reasoningConfig, String defaultLevel) {
        Object rawBudgets = reasoningConfig.get("budgets");
        if (!(rawBudgets instanceof Map)) {
            return null;
        }
        Object budget = ((Map<String, Object>) rawBudgets).get(defaultLevel);
        return budget instanceof Number ? ((Number) budget).intValue() : null;
    }

    private String normalizeString(Object value, String fallback) {
        if (value == null || StringUtils.isBlank(String.valueOf(value))) {
            return fallback;
        }
        return String.valueOf(value).trim().toLowerCase(Locale.ROOT);
    }
}
