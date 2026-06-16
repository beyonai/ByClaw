package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * OpenAI服务实现 直接使用OpenAI API规范
 */
@Service
public class AIService {

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

            List<Map<String, String>> messages = new ArrayList<>();
            if (StringUtils.isNotBlank(systemPrompt)) {
                messages.add(Map.of("role", "system", "content", systemPrompt));
            }
            messages.add(Map.of("role", "user", "content", userPrompt));
            requestBody.put("messages", messages);

            requestBody.put("temperature", 0.7);
            requestBody.put("max_tokens", maxTokens);
            applyThinkingParams(requestBody, defaultModel);

            // 设置请求头
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
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
                    Map<String, String> message = (Map<String, String>) firstChoice.get("message");
                    return message.get("content");
                }
            }
            throw new BaseException(I18nUtil.get("ai.openai.api.request.failed", response.getStatusCode()));
        }
        catch (Exception e) {
            throw new BaseException(I18nUtil.get("ai.openai.api.call.failed", e.getMessage()), e);
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
                }
                else {
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
