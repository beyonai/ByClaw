package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ToolSandboxMarketControllerTest {
    @Test void deniesAnonymousRequests() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            var controller = new ToolSandboxMarketController(mock(SandboxServiceSpecEntityMapper.class), mock(PlatformRemoteGateway.class));
            assertThrows(ResponseStatusException.class, controller::list);
        }
    }

    @Test void exposesOnlySafeAdmittedMetadataAndActualTemplateBuildState() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("own-user");
            var specs = mock(SandboxServiceSpecEntityMapper.class);
            var platform = mock(PlatformRemoteGateway.class);
            when(platform.isRemote()).thenReturn(true);
            var row = new SandboxServiceSpecEntity();
            row.setServiceKey("byclaw-tools-browser"); row.setOwnerScope("USER"); row.setEnabled(1);
            row.setSpecJson("{\"env\":{\"INTERNAL_API_TOKEN\":\"secret-fixture\"},\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\",\"imageTag\":\"D0.6.0-browser\",\"capabilities\":\"[\\\"browser.automation\\\"]\"}}}");
            when(specs.selectProfileAwareByServiceKey("byclaw-tools-browser")).thenReturn(row);
            when(platform.controller(eq("templateRebuild/records"), anyMap())).thenReturn(
                ResponseUtil.successResponse(Map.of("records", List.of(Map.of("state", "SUCCEEDED", "actorName", "private-actor")))));
            var controller = new ToolSandboxMarketController(specs, platform);
            var entries = (List<Map<String, Object>>) controller.list().getData();
            assertEquals(1, entries.size()); assertEquals(true, entries.getFirst().get("ready"));
            assertEquals(List.of("browser.automation"), entries.getFirst().get("capabilities"));
            assertFalse(entries.toString().contains("secret-fixture")); assertFalse(entries.toString().contains("private-actor"));
            row.setOwnerScope("TENANT");
            assertTrue(((List<?>) controller.list().getData()).isEmpty());
        }
    }
}
