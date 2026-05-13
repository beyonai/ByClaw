package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
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
        Map<String, String> defaultModel = getDefaultModel();
        String apiUrl = defaultModel.get("apiUrl");
        String apiKey = defaultModel.get("apiKey");
        String model = defaultModel.get("model");
        if (StringUtils.isNotBlank(modelCode)) {
            model = modelCode;
        }
        try {
            // 构造请求体
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("model", model);

            List<Map<String, String>> messages = new ArrayList<>();
            messages.add(Map.of("role", "user", "content", prompt));
            requestBody.put("messages", messages);

            requestBody.put("temperature", 0.7);
            requestBody.put("max_tokens", 4000);
            requestBody.put("enable_thinking", false);

            // 关掉思考过程
            requestBody.put("chat_template_kwargs", Map.of("enable_thinking", false));

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
}
