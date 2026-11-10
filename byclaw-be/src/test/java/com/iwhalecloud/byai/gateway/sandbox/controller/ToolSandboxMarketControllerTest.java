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
            when(specs.selectList(null)).thenReturn(List.of(row));
            when(platform.controller(eq("listServiceSpec"), anyMap())).thenReturn(ResponseUtil.successResponse(List.of(row)));
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
    @Test void listsCustomTemplatesAndIndependentSwitchWithoutExposingConfiguration() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("own-user");
            var specs = mock(SandboxServiceSpecEntityMapper.class);
            var row = new SandboxServiceSpecEntity();
            row.setServiceKey("custom-tool"); row.setOwnerScope("USER"); row.setEnabled(1);
            row.setSpecJson("{\"env\":{\"TOKEN\":\"private-secret\"},\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\",\"purpose\":\"analysis\",\"enabled\":\"false\",\"description\":\"Analyze data\",\"coverImage\":\"https://example.org/cover.png\",\"capabilities\":\"[\\\"data.analysis\\\"]\"}}}");
            when(specs.selectList(null)).thenReturn(List.of(row));
            var result = (List<Map<String, Object>>) new ToolSandboxMarketController(specs,
                mock(PlatformRemoteGateway.class)).list().getData();
            assertEquals(1, result.size());
            assertEquals("analysis", result.getFirst().get("templateKey"));
            assertEquals(false, result.getFirst().get("enabled"));
            assertEquals("Analyze data", result.getFirst().get("description"));
            assertEquals("https://example.org/cover.png", result.getFirst().get("coverImage"));
            assertFalse(result.toString().contains("private-secret"));
        }
    }

    @Test void executionCatalogOmitsArtworkAndBuildHistoryAndStillEnforcesAuthentication() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            var specs = mock(SandboxServiceSpecEntityMapper.class);
            var platform = mock(PlatformRemoteGateway.class);
            var controller = new ToolSandboxMarketController(specs, platform);
            assertThrows(ResponseStatusException.class, controller::catalog);
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("own-user");
            var row = new SandboxServiceSpecEntity();
            row.setServiceKey("byclaw-tools-browser"); row.setOwnerScope("USER"); row.setEnabled(1);
            row.setSpecJson("{\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\",\"coverImage\":\"https://example.org/cover.png\",\"capabilities\":\"[\\\"browser.automation\\\"]\"}}}");
            when(specs.selectList(null)).thenReturn(List.of(row));
            var entries = (List<Map<String, Object>>) controller.catalog().getData();
            assertEquals(1, entries.size());
            assertEquals(java.util.Set.of("templateKey", "serviceKey", "capabilities", "enabled"), entries.getFirst().keySet());
            verify(platform, never()).controller(anyString(), anyMap());
        }
    }

    @Test void conflictingOrInvalidTemplateKeysDoNotPoisonUnrelatedTemplates() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("own-user");
            var specs = mock(SandboxServiceSpecEntityMapper.class);
            List<SandboxServiceSpecEntity> rows = new java.util.ArrayList<>();
            for (String key : List.of("custom-a", "custom-b", "INVALID_KEY", "byclaw-tools-browser")) {
                var row = new SandboxServiceSpecEntity();
                row.setServiceKey(key); row.setOwnerScope("USER"); row.setEnabled(1);
                String purpose = key.startsWith("custom") ? ",\"purpose\":\"analysis\"" : "";
                row.setSpecJson("{\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\"" + purpose + "}}}");
                rows.add(row);
            }
            when(specs.selectList(null)).thenReturn(rows);
            var controller = new ToolSandboxMarketController(specs, mock(PlatformRemoteGateway.class));
            var catalog = (List<Map<String, Object>>) controller.catalog().getData();
            assertEquals(1, catalog.size());
            assertEquals("browser", catalog.getFirst().get("templateKey"));
            var display = (List<Map<String, Object>>) controller.list().getData();
            assertEquals(4, display.size());
            assertEquals(1, display.stream().filter(e -> Boolean.TRUE.equals(e.get("available"))).count());
        }
    }
    @Test void catalogHttpRouteUsesRemoteSpecStringsAndReturnsOnlyExecutionFields() throws Exception {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("own-user");
            var specs = mock(SandboxServiceSpecEntityMapper.class);
            var platform = mock(PlatformRemoteGateway.class);
            when(platform.isRemote()).thenReturn(true);
            String spec = "{\"env\":{\"TOKEN\":\"private-execution-secret\"},\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\",\"coverImage\":\"https://example.org/private-cover.png\",\"capabilities\":\"[\\\"browser.automation\\\",\\\"INVALID CAPABILITY\\\"]\"}}}";
            Map<String,Object> active = Map.of("serviceKey", "byclaw-tools-browser", "ownerScope", "USER",
                "enabled", "1", "autoscaleEnabled", "0", "defaultProfileKey", "private-profile", "specJson", spec,
                "templateJson", "{\"password\":\"private-template-secret\"}");
            Map<String,Object> disabled = Map.of("serviceKey", "byclaw-tools-media", "ownerScope", "USER",
                "enabled", "0", "specJson", spec);
            Map<String,Object> tenant = Map.of("serviceKey", "tenant-tool", "ownerScope", "TENANT",
                "enabled", "1", "specJson", spec);
            when(platform.controller(eq("listServiceSpec"), anyMap()))
                .thenReturn(ResponseUtil.successResponse(List.of(active, disabled, tenant)));
            var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(
                new ToolSandboxMarketController(specs, platform)).build();
            String body = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .post("/sandbox/toolTemplates/catalog").contentType("application/json").content("{}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andReturn().getResponse().getContentAsString();
            var data = new com.fasterxml.jackson.databind.ObjectMapper().readTree(body);
            assertEquals(ResponseUtil.SUCCESS, data.path("code").asInt());
            assertEquals(2, data.path("data").size());
            var entry = data.path("data").get(0);
            java.util.Set<String> fields = new java.util.HashSet<>();entry.fieldNames().forEachRemaining(fields::add);
            assertEquals(java.util.Set.of("templateKey", "serviceKey", "capabilities", "enabled"), fields);
            assertEquals("browser", entry.path("templateKey").asText());
            assertEquals("browser.automation", entry.path("capabilities").get(0).asText());
            assertEquals(1, entry.path("capabilities").size());
            assertTrue(entry.path("enabled").asBoolean());
            assertFalse(data.path("data").get(1).path("enabled").asBoolean());
            assertFalse(body.contains("private-"));
            verify(platform, times(1)).controller(anyString(), anyMap());
            verify(platform, never()).controller(eq("templateRebuild/records"), anyMap());
            verifyNoInteractions(specs);
        }
    }

    @Test void catalogHttpRouteRejectsAnonymousRequestsBeforeAnyLookup() throws Exception {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            var specs = mock(SandboxServiceSpecEntityMapper.class);
            var platform = mock(PlatformRemoteGateway.class);
            var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(
                new ToolSandboxMarketController(specs, platform)).build();
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .post("/sandbox/toolTemplates/catalog").contentType("application/json").content("{}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
            verifyNoInteractions(specs, platform);
        }
    }

    @Test void failedRemoteSpecLookupCannotBecomeAnEmptySuccessfulCatalog() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("own-user");
            var specs = mock(SandboxServiceSpecEntityMapper.class);
            var platform = mock(PlatformRemoteGateway.class);
            when(platform.isRemote()).thenReturn(true);
            when(platform.controller(eq("listServiceSpec"), anyMap())).thenReturn(ResponseUtil.fail("catalog source unavailable"));
            var result = new ToolSandboxMarketController(specs, platform).catalog();
            assertEquals(ResponseUtil.FAIL, result.getCode());
            verify(platform, times(1)).controller(anyString(), anyMap());
            verifyNoInteractions(specs);
        }
    }

    @Test void extraRemoteManagementFieldsDoNotBreakOrLeakIntoTheExecutionCatalog() throws Exception {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("own-user");
            var specs = mock(SandboxServiceSpecEntityMapper.class);
            var platform = mock(PlatformRemoteGateway.class);
            when(platform.isRemote()).thenReturn(true);
            String spec = "{\"runtimeOptions\":{\"toolSandbox\":{\"contract\":\"byclaw.tool-sandbox/v1\"}}}";
            Map<String,Object> row = Map.of("serviceKey", "byclaw-tools-browser", "ownerScope", "USER", "enabled", "1",
                "specJson", spec, "validationError", "private-validation-secret",
                "runtimeEnv", Map.of("ADMIN_TOKEN", "private-runtime-secret"));
            when(platform.controller(eq("listServiceSpec"), anyMap())).thenReturn(ResponseUtil.successResponse(List.of(row)));
            var response = assertDoesNotThrow(new ToolSandboxMarketController(specs, platform)::catalog);
            assertEquals(ResponseUtil.SUCCESS, response.getCode());
            assertEquals(1, ((List<?>) response.getData()).size());
            String body = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(response);
            assertFalse(body.contains("private-"));assertFalse(body.contains("validationError"));assertFalse(body.contains("runtimeEnv"));
            verify(platform, times(1)).controller(anyString(), anyMap());verifyNoInteractions(specs);
        }
    }

}
