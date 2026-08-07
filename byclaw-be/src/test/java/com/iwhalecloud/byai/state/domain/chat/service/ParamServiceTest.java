package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class ParamServiceTest {

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
}
