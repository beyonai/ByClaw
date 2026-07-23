package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import org.junit.jupiter.api.Test;

class RecorderLlmServiceTest {

    @Test
    void reportsAvailableOnlyWhenTheDefaultModelHasServerSideConnectionDetails() {
        AiModelService models = mock(AiModelService.class);
        ModelDto model = new ModelDto();
        model.setModelCode("default-chat");
        model.setUrl("https://model.example");
        model.setAuthToken("server-only-token");
        when(models.getDefaultChatModel()).thenReturn(model);

        RecorderLlmService service = new RecorderLlmService(models, mock(AIService.class));

        assertThat(service.availability())
            .isEqualTo(new RecorderLlmService.Availability(true, "default-chat"));
    }

    @Test
    void treatsMissingDefaultModelAsNonBlockingUnavailable() {
        AiModelService models = mock(AiModelService.class);
        when(models.getDefaultChatModel()).thenThrow(new IllegalStateException("not configured"));

        RecorderLlmService service = new RecorderLlmService(models, mock(AIService.class));

        assertThat(service.availability().available()).isFalse();
    }
}
