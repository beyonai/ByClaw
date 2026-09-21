package com.iwhalecloud.byai.state.interfaces.controller.dataset;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.domain.resource.service.ToolManService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.mockito.Mockito.*;

class DatasetControllerLifecycleTest {
    @Test
    void legacyDeletionUsesTheSharedLifecycle() {
        DatasetController controller = new DatasetController();
        ToolManService service = mock(ToolManService.class);
        ReflectionTestUtils.setField(controller, "toolManService", service);
        com.iwhalecloud.byai.manager.dto.resource.DatasetIdDto request =
            new com.iwhalecloud.byai.manager.dto.resource.DatasetIdDto();
        request.setResourceId(10L);
        try (var messages = mockStatic(I18nUtil.class)) {
            controller.deleteDataset(request);
        }
        verify(service).deregisterResource(10L);
    }
}
