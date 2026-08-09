package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class DevloopControllerTaskFileDiffTest {

    @Test
    void passesRepoIdToApplicationService() {
        DevloopApplicationService applicationService = mock(DevloopApplicationService.class);
        DevloopController controller = new DevloopController();
        ReflectionTestUtils.setField(controller, "applicationService", applicationService);
        ResponseUtil<Map<String, Object>> expected = ResponseUtil.successResponse(Map.of("status", "ok"));
        when(applicationService.getTaskFileDiff(5001L, 301L, "src/App.java")).thenReturn(expected);

        ResponseUtil<Map<String, Object>> actual = controller.getTaskFileDiff(Map.of(
            "sessionId", 5001L,
            "repoId", 301L,
            "filePath", "src/App.java"));

        assertThat(actual).isSameAs(expected);
        verify(applicationService).getTaskFileDiff(5001L, 301L, "src/App.java");
    }

    @Test
    void allowsRepoIdToBeOmitted() {
        DevloopApplicationService applicationService = mock(DevloopApplicationService.class);
        DevloopController controller = new DevloopController();
        ReflectionTestUtils.setField(controller, "applicationService", applicationService);
        ResponseUtil<Map<String, Object>> expected = ResponseUtil.successResponse(Map.of("status", "ok"));
        when(applicationService.getTaskFileDiff(5001L, null, "src/App.java")).thenReturn(expected);

        ResponseUtil<Map<String, Object>> actual = controller.getTaskFileDiff(Map.of(
            "sessionId", 5001L,
            "filePath", "src/App.java"));

        assertThat(actual).isSameAs(expected);
        verify(applicationService).getTaskFileDiff(5001L, null, "src/App.java");
    }
}
