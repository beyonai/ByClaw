package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import org.springframework.stereotype.Service;

/**
 * Recorder's server-side boundary for the configured default chat model.
 *
 * <p>The browser only learns whether a usable default model is configured. Model URLs and credentials stay in the
 * model service and are never returned by recorder APIs.</p>
 */
@Service
public class RecorderLlmService {

    private final AiModelService aiModelService;
    private final AIService aiService;

    public RecorderLlmService(AiModelService aiModelService, AIService aiService) {
        this.aiModelService = aiModelService;
        this.aiService = aiService;
    }

    private RecorderLlmService() {
        this.aiModelService = null;
        this.aiService = null;
    }

    static RecorderLlmService unavailable() {
        return new RecorderLlmService();
    }

    public Availability availability() {
        if (aiModelService == null) {
            return Availability.unavailable();
        }
        try {
            ModelDto model = aiModelService.getDefaultChatModel();
            if (model == null || isBlank(model.getUrl()) || isBlank(model.getAuthToken()) || isBlank(model.getModelCode())) {
                return Availability.unavailable();
            }
            return new Availability(true, model.getModelCode());
        } catch (RuntimeException ignored) {
            // A missing/invalid default model is a non-blocking recorder health degradation.
            return Availability.unavailable();
        }
    }

    public String generateText(String systemPrompt, String userPrompt, int maxTokens) {
        if (!availability().available()) {
            throw new IllegalStateException("default LLM model is unavailable");
        }
        return aiService.generateText(systemPrompt, userPrompt, null, maxTokens);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    public record Availability(boolean available, String modelCode) {
        static Availability unavailable() {
            return new Availability(false, null);
        }
    }
}
