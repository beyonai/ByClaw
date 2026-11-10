package com.iwhalecloud.byai.gateway.sandbox.controller;

import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ToolTemplateSaveValidationTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    @Test void malformedOrUnsafeTemplateMetadataDoesNotReachPersistence() {
        for (String spec : new String[] {"[]", "invalid-json",
                "{\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\",\"description\":{}}}}",
                "{\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\",\"coverImage\":[]}}}",
                "{\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\",\"coverImage\":\"javascript:alert(1)\"}}}",
                "{\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\",\"enabled\":\"unexpected\"}}}"}) {
            SandboxController controller = new SandboxController();
            var mapper = mock(SandboxServiceSpecEntityMapper.class);
            ReflectionTestUtils.setField(controller, "sandboxServiceSpecEntityMapper", mapper);
            assertEquals(ResponseUtil.FAIL, controller.saveServiceSpec(Map.of("serviceKey", "tool-browser", "specJson", spec)).getCode());
            verifyNoInteractions(mapper);
        }
    }
}
