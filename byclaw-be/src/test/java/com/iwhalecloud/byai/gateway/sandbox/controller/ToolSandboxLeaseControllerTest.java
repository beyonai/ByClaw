package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ToolSandboxLeaseControllerTest {
    @Test void rejectsAnonymousForeignOwnerAndForgedProjectionBeforeForwarding() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            var platform = mock(PlatformRemoteGateway.class);
            when(platform.isRemote()).thenReturn(true);
            var controller = new ToolSandboxLeaseController(platform);
            assertThrows(ResponseStatusException.class, () -> controller.operation("acquire", Map.of()));
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("owner");
            assertThrows(ResponseStatusException.class, () -> controller.operation("acquire", Map.of("userCode", "other")));
            assertThrows(ResponseStatusException.class, () -> controller.operation("acquire", Map.of("userInfo", Map.of("userCode", "other"))));
            assertThrows(ResponseStatusException.class, () -> controller.operation("dropAll", Map.of()));
            verify(platform, never()).toolLease(anyString(), anyMap());
        }
    }

    @Test void forwardsOnlyAuthenticatedOwnerAndPreservesToolSessionAndParentFence() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("owner");
            var platform = mock(PlatformRemoteGateway.class);
            when(platform.isRemote()).thenReturn(true);
            var result = Map.of("leaseId", "lease-one", "sandboxId", "sbx-one");
            when(platform.toolLease(eq("acquire"), anyMap())).thenReturn(result);
            var request = Map.<String,Object>of("serviceKey", "byclaw-dsh-tools", "toolSessionId", "conversation-1",
                "holderId", "process-1", "parentContextId", "member-one", "parentContextGeneration", 7,
                "parentSandboxId", "shared-one");
            ResponseUtil response = new ToolSandboxLeaseController(platform).operation("acquire", request);
            assertEquals(0, response.getCode());
            assertEquals(result, response.getData());
            var expected = new java.util.LinkedHashMap<String,Object>(request);
            expected.put("userCode", "owner");
            verify(platform).toolLease("acquire", expected);
            assertFalse(request.containsKey("userCode"));
        }
    }

    @Test void unavailableExecutionSideDoesNotLaunchWithoutALease() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("owner");
            var platform = mock(PlatformRemoteGateway.class);
            assertThrows(ResponseStatusException.class, () -> new ToolSandboxLeaseController(platform).operation("acquire", Map.of()));
            verify(platform, never()).toolLease(anyString(), anyMap());
        }
    }
}
