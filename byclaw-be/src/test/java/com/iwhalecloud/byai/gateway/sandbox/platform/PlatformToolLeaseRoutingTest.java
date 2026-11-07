package com.iwhalecloud.byai.gateway.sandbox.platform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.env.MockEnvironment;

class PlatformToolLeaseRoutingTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    @Test void forwardsExactOperationAndKeepsConversationSeparateFromLoginProjection() {
        try (var auth = mockStatic(CurrentUserHolder.class)) {
            auth.when(CurrentUserHolder::getCurrentUserCode).thenReturn("owner");
            var login = new com.iwhalecloud.byai.common.login.bean.LoginInfo();
            login.setUserCode("owner");
            login.setSessionId("trusted-login-session");
            auth.when(CurrentUserHolder::getLoginInfo).thenReturn(login);
            var client = mock(PlatformControlClient.class);
            ObjectProvider<PlatformControlClient> provider = mock(ObjectProvider.class);
            when(provider.getObject()).thenReturn(client);
            when(client.call(eq("sandbox"), eq("tool-leases/acquire"), any()))
                .thenReturn(Map.of("code", 0, "data", Map.of("leaseId", "one")));
            var gateway = new PlatformRemoteGateway(mock(PlatformBackgroundExecution.class), provider,
                new ObjectMapper(), new MockEnvironment().withProperty("byclaw.platform.base-url", "http://127.0.0.1:8087"));
            var params = Map.<String,Object>of("userCode", "owner", "sessionId", "conversation-id");
            assertEquals(Map.of("leaseId", "one"), gateway.toolLease("acquire", params));
            var capture = ArgumentCaptor.forClass(Object.class);
            verify(client).call(eq("sandbox"), eq("tool-leases/acquire"), capture.capture());
            var sent = (Map<?,?>) capture.getValue();
            assertEquals("conversation-id", sent.get("toolSessionId"));
            assertFalse(sent.containsKey("sessionId"));
            assertEquals("trusted-login-session", sent.get("loginSessionId"));
            assertEquals("trusted-login-session", ((Map<?, ?>) sent.get("userInfo")).get("sessionId"));
            assertEquals("owner", sent.get("operatorUserCode"));
            assertFalse(params.containsKey("operatorUserCode"));
            when(client.call(eq("sandbox"), eq("tool-leases/acquire"), any()))
                .thenReturn(Map.of("code", -1, "msg", "TOOL_LEASE_BUSY", "data", Map.of("errorType", "TOOL_LEASE_BUSY")));
            var failure = assertThrows(com.iwhalecloud.byai.state.common.exception.BdpRuntimeException.class,
                () -> gateway.toolLease("acquire", params));
            assertEquals("TOOL_LEASE_BUSY", failure.getMessage());
        }
    }
}
