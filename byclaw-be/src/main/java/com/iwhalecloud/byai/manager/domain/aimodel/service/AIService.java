package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * OpenAI服务实现 直接使用OpenAI API规范
 */
@Service
public class AIService {

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");

    @Autowired
    private AiModelService aiModelService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private Map<String, String> getDefaultModel() {
        ModelDto defaultModel = aiModelService.getDefaultChatModel();
        if (defaultModel == null) {
            throw new BdpRuntimeException(I18nUtil.get("ai.service.no.default.model.found"));
        }
        Map<String, String> model = new HashMap<>();
        model.put("model", defaultModel.getModelCode());
        model.put("apiUrl", defaultModel.getUrl() + "/chat/completions");
        model.put("apiKey", defaultModel.getAuthToken());
        return model;
    }

    public String generateText(String prompt, String modelCode) {
        return generateText(null, prompt, modelCode, 4000);
    }

    public String generateText(String systemPrompt, String userPrompt, String modelCode, int maxTokens) {
        Map<String, String> defaultModel = getDefaultModel();
        String apiUrl = defaultModel.get("apiUrl");
        String apiKey = defaultModel.get("apiKey");
        String model = defaultModel.get("model");
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
            requestBody.put("max_tokens", maxTokens);
            requestBody.put("enable_thinking", false);
            requestBody.put("chat_template_kwargs", Map.of("enable_thinking", false));

            Request request = new Request.Builder()
                .url(apiUrl)
                .post(RequestBody.create(objectMapper.writeValueAsString(requestBody), JSON_MEDIA_TYPE))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .header("X-CHANNEL", "BYAI")
                .build();

            try (Response response = OkHttpUtil.getHttpClient().newCall(request).execute()) {
                if (response.code() == HttpStatus.OK.value()) {
                    String responseBody = response.body() != null ? response.body().string() : null;
                    Map<String, Object> responseMap = objectMapper.readValue(responseBody, Map.class);
                    List<Map<String, Object>> choices = (List<Map<String, Object>>) responseMap.get("choices");
                    if (choices != null && !choices.isEmpty()) {
                        Map<String, Object> firstChoice = choices.get(0);
                        Map<String, String> message = (Map<String, String>) firstChoice.get("message");
                        return message.get("content");
                    }
                }
                throw new BaseException(I18nUtil.get("ai.openai.api.request.failed", response.code()));
            }
        }
        catch (Exception e) {
            throw new BaseException(I18nUtil.get("ai.openai.api.call.failed", e.getMessage()), e);
        }
    }
}
