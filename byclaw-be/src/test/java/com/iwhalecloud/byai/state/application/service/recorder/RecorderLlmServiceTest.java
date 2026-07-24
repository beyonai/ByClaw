package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListResponse;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelVO;
import java.util.List;
import org.junit.jupiter.api.Test;

class RecorderLlmServiceTest {

    @Test
    void resolvesTheDefaultModelThroughModelManagementListAndDetail() {
        ModelManagementApplicationService models = mock(ModelManagementApplicationService.class);
        ModelVO listedModel = model("12", 1, null, null, "default-chat");
        ModelVO detail = model("12", 1, "https://model.example", "server-only-token", "default-chat");
        ModelListResponse page = new ModelListResponse();
        page.setRows(List.of(listedModel));
        when(models.getModelListByPage(org.mockito.ArgumentMatchers.any())).thenReturn(page);
        when(models.getModelDetail("12")).thenReturn(detail);

        RecorderLlmService service = new RecorderLlmService(models, mock(AIService.class));

        assertThat(service.availability())
            .isEqualTo(new RecorderLlmService.Availability(true, "default-chat", "available"));
    }

    @Test
    void reportsAMissingCredentialWithoutExposingModelDetails() {
        ModelManagementApplicationService models = mock(ModelManagementApplicationService.class);
        ModelVO listedModel = model("12", 1, null, null, "default-chat");
        ModelVO detail = model("12", 1, "https://model.example", null, "default-chat");
        ModelListResponse page = new ModelListResponse();
        page.setRows(List.of(listedModel));
        when(models.getModelListByPage(org.mockito.ArgumentMatchers.any())).thenReturn(page);
        when(models.getModelDetail("12")).thenReturn(detail);

        RecorderLlmService service = new RecorderLlmService(models, mock(AIService.class));

        assertThat(service.availability())
            .isEqualTo(new RecorderLlmService.Availability(false, null, "default_model_token_missing"));
    }

    @Test
    void reportsListLookupFailureAsNonBlockingUnavailable() {
        ModelManagementApplicationService models = mock(ModelManagementApplicationService.class);
        when(models.getModelListByPage(org.mockito.ArgumentMatchers.any())).thenThrow(new IllegalStateException("not configured"));

        RecorderLlmService service = new RecorderLlmService(models, mock(AIService.class));

        assertThat(service.availability())
            .isEqualTo(new RecorderLlmService.Availability(false, null, "default_model_list_lookup_failed"));
    }

    @Test
    void reportsDetailLookupFailureAsNonBlockingUnavailable() {
        ModelManagementApplicationService models = mock(ModelManagementApplicationService.class);
        ModelListResponse page = new ModelListResponse();
        page.setRows(List.of(model("12", 1, null, null, "default-chat")));
        when(models.getModelListByPage(org.mockito.ArgumentMatchers.any())).thenReturn(page);
        when(models.getModelDetail("12")).thenThrow(new IllegalStateException("details unavailable"));

        RecorderLlmService service = new RecorderLlmService(models, mock(AIService.class));

        assertThat(service.availability())
            .isEqualTo(new RecorderLlmService.Availability(false, null, "default_model_detail_lookup_failed"));
    }

    @Test
    void ignoresNonLlmDefaultsWhenSelectingTheRecorderModel() {
        ModelManagementApplicationService models = mock(ModelManagementApplicationService.class);
        ModelVO embedding = model("11", 1, null, null, "embedding-default");
        embedding.setModelType("EMBEDDING");
        ModelVO chat = model("12", 0, null, null, "default-chat");
        ModelListResponse page = new ModelListResponse();
        page.setRows(List.of(embedding, chat));
        when(models.getModelListByPage(org.mockito.ArgumentMatchers.any())).thenReturn(page);
        when(models.getModelDetail("12")).thenReturn(model("12", 0, "https://model.example", "token", "default-chat"));

        RecorderLlmService service = new RecorderLlmService(models, mock(AIService.class));

        assertThat(service.availability())
            .isEqualTo(new RecorderLlmService.Availability(true, "default-chat", "available"));
    }

    @Test
    void sendsTheModelResolvedFromManagementToTheLlmClient() {
        ModelManagementApplicationService models = mock(ModelManagementApplicationService.class);
        AIService aiService = mock(AIService.class);
        ModelVO listedModel = model("12", 1, null, null, "default-chat");
        ModelVO detail = model("12", 1, "https://model.example", "server-only-token", "default-chat");
        ModelListResponse page = new ModelListResponse();
        page.setRows(List.of(listedModel));
        when(models.getModelListByPage(org.mockito.ArgumentMatchers.any())).thenReturn(page);
        when(models.getModelDetail("12")).thenReturn(detail);
        when(aiService.generateText(org.mockito.ArgumentMatchers.<String>any(), org.mockito.ArgumentMatchers.<String>any(),
            org.mockito.ArgumentMatchers.any(ModelDto.class), org.mockito.ArgumentMatchers.anyInt())).thenReturn("[]");

        RecorderLlmService service = new RecorderLlmService(models, aiService);

        assertThat(service.generateText("system", "user", 1200)).isEqualTo("[]");
        verify(aiService).generateText(org.mockito.ArgumentMatchers.eq("system"), org.mockito.ArgumentMatchers.eq("user"),
            org.mockito.ArgumentMatchers.<ModelDto>argThat(resolved ->
            "https://model.example".equals(resolved.getUrl())
                && "server-only-token".equals(resolved.getAuthToken())
                && "default-chat".equals(resolved.getModelCode())), org.mockito.ArgumentMatchers.eq(1200));
    }

    @Test
    void requestsStructuredJsonFromTheResolvedRecorderModel() {
        ModelManagementApplicationService models = mock(ModelManagementApplicationService.class);
        AIService aiService = mock(AIService.class);
        ModelVO listedModel = model("12", 1, null, null, "default-chat");
        ModelVO detail = model("12", 1, "https://model.example", "server-only-token", "default-chat");
        ModelListResponse page = new ModelListResponse();
        page.setRows(List.of(listedModel));
        when(models.getModelListByPage(org.mockito.ArgumentMatchers.any())).thenReturn(page);
        when(models.getModelDetail("12")).thenReturn(detail);
        when(aiService.generateJsonObjectWithMetadata(
            org.mockito.ArgumentMatchers.<String>any(),
            org.mockito.ArgumentMatchers.<String>any(),
            org.mockito.ArgumentMatchers.any(ModelDto.class),
            org.mockito.ArgumentMatchers.anyInt()
        )).thenReturn(new AIService.GeneratedText("{}", "stop"));

        RecorderLlmService service = new RecorderLlmService(models, aiService);

        assertThat(service.generateJsonObjectWithMetadata("system", "user", 1200))
            .isEqualTo(new RecorderLlmService.JsonObjectResponse("{}", "stop"));
        verify(aiService).generateJsonObjectWithMetadata(
            org.mockito.ArgumentMatchers.eq("system"),
            org.mockito.ArgumentMatchers.eq("user"),
            org.mockito.ArgumentMatchers.<ModelDto>argThat(resolved -> "default-chat".equals(resolved.getModelCode())),
            org.mockito.ArgumentMatchers.eq(1200)
        );
    }

    private ModelVO model(String id, int isDefault, String endpoint, String token, String modelCode) {
        ModelVO model = new ModelVO();
        model.setId(Long.valueOf(id));
        model.setIsDefault(isDefault);
        model.setApiEndpoint(endpoint);
        model.setApiToken(token);
        model.setModelCode(modelCode);
        model.setModelType("LLM");
        return model;
    }
}
