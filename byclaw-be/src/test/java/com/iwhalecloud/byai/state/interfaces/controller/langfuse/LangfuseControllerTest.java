package com.iwhalecloud.byai.state.interfaces.controller.langfuse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.langfuse.service.LangfuseAuthorizationService;
import com.iwhalecloud.byai.state.domain.langfuse.service.LangfuseService;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class LangfuseControllerTest {

    @Test
    void getLangfuseConfigAllowsMissingOptionalValues() {
        LangfuseService langfuseService = mock(LangfuseService.class);
        when(langfuseService.getLangfuseHost()).thenReturn(null);
        when(langfuseService.getLangfuseEnv()).thenReturn(null);
        when(langfuseService.getLangfuseProjectId()).thenReturn(null);
        when(langfuseService.getLangfuseSecretKey()).thenReturn("");
        when(langfuseService.getLangfusePublicKey()).thenReturn("");

        LangfuseAuthorizationService langfuseAuth = mock(LangfuseAuthorizationService.class);
        doNothing().when(langfuseAuth).requireLogin();

        LangfuseController controller = new LangfuseController();
        ReflectionTestUtils.setField(controller, "langfuseService", langfuseService);
        ReflectionTestUtils.setField(controller, "langfuseAuth", langfuseAuth);

        ResponseUtil response = controller.getLangfuseConfig();

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        assertThat(response.getData()).isInstanceOf(Map.class);
        Map<String, Object> data = (Map<String, Object>) response.getData();
        assertThat(data).containsEntry("host", null)
            .containsEntry("environment", null)
            .containsEntry("projectId", null)
            .containsEntry("hasSecretKey", false)
            .containsEntry("hasPublicKey", false)
            .containsEntry("enabled", false);
    }
}
