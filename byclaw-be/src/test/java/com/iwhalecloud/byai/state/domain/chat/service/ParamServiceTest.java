package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import java.io.ByteArrayOutputStream;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

class ParamServiceTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {

    private ParamService service;
    private SsResourceService ssResourceService;

    @BeforeEach
    void setUp() {
        service = new ParamService();
        ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
    }

    @Test
    void resolveWorkerAgentType_routesNullAgentIdToBySuper() {
        assertThat(service.resolveWorkerAgentType(null)).isEqualTo(WorkerAgentType.BY_SUPER.getCode());
        verifyNoInteractions(ssResourceService);
    }

    @Test
    void resolveWorkerAgentType_usesConfiguredResourceWorker() {
        SsResource resource = new SsResource();
        resource.setWorkerAgentType(WorkerAgentType.BYCLAW_QA.getCode());
        when(ssResourceService.findById(100L)).thenReturn(resource);

        assertThat(service.resolveWorkerAgentType(100L)).isEqualTo(WorkerAgentType.BYCLAW_QA.getCode());
        verify(ssResourceService).findById(100L);
    }

    @Test
    void resolveWorkerAgentType_keepsLegacyFallbackForUnknownNonNullAgentId() {
        when(ssResourceService.findById(404L)).thenReturn(null);

        assertThat(service.resolveWorkerAgentType(404L)).isEqualTo(WorkerAgentType.BYCLAW_EXE.getCode());
        verify(ssResourceService).findById(404L);
    }

    @ParameterizedTest
    @ValueSource(strings = {"HARNESS", "BY_SUPER"})
    void getParams_preservesExpertTeamWorkerAndOrchestration(String workerAgentType) {
        var groups = mock(DigitalEmployeeGroupApplicationService.class);
        ReflectionTestUtils.setField(service, "digitalEmployeeGroupApplicationService", groups);
        ReflectionTestUtils.setField(service, "resourceAuthContextService", mock(ResourceAuthContextService.class));
        SsResource group = new SsResource();
        group.setResourceId(100L);
        group.setWorkerAgentType(workerAgentType);
        when(ssResourceService.findById(100L)).thenReturn(group);
        when(groups.isGroup(100L)).thenReturn(true);
        AssistantChatDto dto = new AssistantChatDto();
        dto.setAgentId(100L);
        ChatProcessContext ctx = new ChatProcessContext(new ByteArrayOutputStream(), dto);

        Map<String, Object> params = service.getParams(ctx);

        assertThat(params).containsEntry("worker_agent_type", workerAgentType)
            .containsEntry("orchestrator", Map.of("schemaVersion", "byclaw.orchestrator-ref/v1",
                "kind", "EXPERT_TEAM", "id", "100"));
    }
}
