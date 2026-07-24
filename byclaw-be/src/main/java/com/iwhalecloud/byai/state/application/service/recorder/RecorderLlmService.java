package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListResponse;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelVO;
import java.util.Comparator;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Recorder's server-side boundary for the configured default chat model.
 *
 * <p>The browser only learns whether a usable default model is configured. Model URLs and credentials stay in the
 * model service and are never returned by recorder APIs.</p>
 */
@Service
@Slf4j
public class RecorderLlmService {

    private static final String AVAILABLE = "available";
    private static final String LLM_MODEL_TYPE = "LLM";

    private final ModelManagementApplicationService modelManagementApplicationService;
    private final AIService aiService;

    public RecorderLlmService(ModelManagementApplicationService modelManagementApplicationService, AIService aiService) {
        this.modelManagementApplicationService = modelManagementApplicationService;
        this.aiService = aiService;
    }

    private RecorderLlmService() {
        this.modelManagementApplicationService = null;
        this.aiService = null;
    }

    static RecorderLlmService unavailable() {
        return new RecorderLlmService();
    }

    public Availability availability() {
        return resolveDefaultModel().availability();
    }

    public String generateText(String systemPrompt, String userPrompt, int maxTokens) {
        ResolvedModel resolved = resolveDefaultModel();
        if (!resolved.availability().available()) {
            throw new IllegalStateException("default LLM model is unavailable: " + resolved.availability().reason());
        }
        return aiService.generateText(systemPrompt, userPrompt, resolved.model(), maxTokens);
    }

    private ResolvedModel resolveDefaultModel() {
        if (modelManagementApplicationService == null) {
            log.warn("Recorder default LLM model list lookup skipped: ModelManagementApplicationService is unavailable");
            return ResolvedModel.unavailable("default_model_list_lookup_failed");
        }
        ModelVO listedModel;
        try {
            ModelListRequest request = new ModelListRequest();
            request.setOwnerType("PUBLIC");
            request.setStatus("ENABLED");
            request.setPageNum(1);
            request.setPageSize(100);
            ModelListResponse page = modelManagementApplicationService.getModelListByPage(request);
            List<ModelVO> rows = page == null || page.getRows() == null ? List.of() : page.getRows();
            listedModel = rows.stream()
                .filter(this::isLlmModel)
                .filter(model -> Integer.valueOf(1).equals(model.getIsDefault()))
                .min(Comparator.comparing(ModelVO::getId, Comparator.nullsLast(Long::compareTo)))
                .orElseGet(() -> rows.stream().filter(this::isLlmModel).findFirst().orElse(null));
        } catch (RuntimeException exception) {
            log.warn("Recorder default LLM model list lookup failed: ownerType=PUBLIC, status=ENABLED, pageNum=1, pageSize=100",
                exception);
            return ResolvedModel.unavailable("default_model_list_lookup_failed");
        }
        if (listedModel == null || listedModel.getId() == null) {
            return ResolvedModel.unavailable("default_model_not_found");
        }

        ModelVO detail;
        String modelId = String.valueOf(listedModel.getId());
        try {
            detail = modelManagementApplicationService.getModelDetail(modelId);
        } catch (RuntimeException exception) {
            log.warn("Recorder default LLM model detail lookup failed: modelId={}", modelId, exception);
            return ResolvedModel.unavailable("default_model_detail_lookup_failed");
        }
        if (detail == null) {
            return ResolvedModel.unavailable("default_model_detail_unavailable");
        }
        if (isBlank(detail.getApiEndpoint())) {
            return ResolvedModel.unavailable("default_model_endpoint_missing");
        }
        if (isBlank(detail.getApiToken())) {
            return ResolvedModel.unavailable("default_model_token_missing");
        }
        if (isBlank(detail.getModelCode())) {
            return ResolvedModel.unavailable("default_model_code_missing");
        }
        ModelDto model = new ModelDto();
        model.setUrl(detail.getApiEndpoint());
        model.setAuthToken(detail.getApiToken());
        model.setModelCode(detail.getModelCode());
        return new ResolvedModel(model, new Availability(true, detail.getModelCode(), AVAILABLE));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private boolean isLlmModel(ModelVO model) {
        return model != null && LLM_MODEL_TYPE.equalsIgnoreCase(model.getModelType());
    }

    public record Availability(boolean available, String modelCode, String reason) {
        static Availability unavailable(String reason) {
            return new Availability(false, null, reason);
        }
    }

    private record ResolvedModel(ModelDto model, Availability availability) {
        static ResolvedModel unavailable(String reason) {
            return new ResolvedModel(null, Availability.unavailable(reason));
        }
    }
}
