package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

class DevloopControllerDwsApiContractTest {

    @Test
    void authStatusKeepsLegacyRouteAndPassesThroughApplicationResponse() throws Exception {
        RequestMapping controllerMapping = DevloopController.class.getAnnotation(RequestMapping.class);
        Method method = DevloopController.class.getMethod("checkDwsAuthStatus");
        PostMapping methodMapping = method.getAnnotation(PostMapping.class);
        assertThat(controllerMapping.value()).containsExactly("/devloop");
        assertThat(methodMapping.value()).containsExactly("/dws/authStatus");

        DevloopApplicationService applicationService = mock(DevloopApplicationService.class);
        DevloopController controller = new DevloopController();
        ReflectionTestUtils.setField(controller, "applicationService", applicationService);
        ResponseUtil<Map<String, Object>> expected = ResponseUtil.successResponse(Map.of(
            "hasToken", true,
            "savedAt", "",
            "runtimeAuthenticated", true,
            "tokenValid", true
        ));
        when(applicationService.checkDwsAuthStatus()).thenReturn(expected);

        ResponseUtil<Map<String, Object>> actual = controller.checkDwsAuthStatus();

        assertThat(actual).isSameAs(expected);
        verify(applicationService).checkDwsAuthStatus();
    }
}
