package com.iwhalecloud.byai.gateway.sandbox.platform;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.shared.PersonalStorageReadinessController;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.env.MockEnvironment;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class PersonalStorageAdmissionDisabledTest {
    @AfterEach void clearIdentity() { CurrentUserHolder.clearLoginInfo(); }

    @Test void disabledAdmissionDoesNotCallUnavailableQuotaServiceForChatOrReadiness() {
        MockEnvironment env = new MockEnvironment()
            .withProperty("byclaw.platform.execution-mode", "remote")
            .withProperty("byclaw.platform.base-url", "http://platform.test")
            .withProperty("byclaw.storage.personal-admission.enabled", "false");
        ObjectProvider<PlatformControlClient> clients = mock(ObjectProvider.class);
        PlatformControlClient client = mock(PlatformControlClient.class);
        when(clients.getObject()).thenReturn(client);
        when(client.call(anyString(), anyString(), any())).thenReturn(
            Map.of("code", 0, "data", Map.of("enabled", true, "ready", false)));
        PlatformRemoteGateway gateway = new PlatformRemoteGateway(new PlatformBackgroundExecution(env),
            clients, new ObjectMapper(), env);
        LoginInfo login = new LoginInfo();
        login.setUserCode("alice");
        CurrentUserHolder.setLoginInfo(login);
        gateway.checkPersonalQuota("CHAT", 0);
        gateway.checkPersonalQuota("UPLOAD", 4096);
        assertThat(gateway.recheckPersonalQuota("alice")).isNull();
        assertThat(gateway.reportQuotaRejection("alice", "request")).isNull();
        assertThat(new PersonalStorageReadinessController(gateway).readiness().getData())
            .isEqualTo(Map.of("enabled", false, "ready", true, "state", "DISABLED"));
        verifyNoInteractions(clients);
        Map<String, Object> ownerLocation = Map.of("bucketOrRoot", "byclaw-alice", "path", "by/file.txt");
        when(client.call("storage", "exists", ownerLocation)).thenReturn(Map.of("code", 0, "data", true));
        assertThat(gateway.call("storage", "exists", ownerLocation)).isEqualTo(true);
        verify(client).call("storage", "exists", ownerLocation);
        assertThatThrownBy(() -> gateway.safe(() -> { throw new IllegalStateException("actual file failure"); }))
            .hasMessage("actual file failure");
    }

    @Test void disabledReadinessStillRequiresAnAuthenticatedUser() {
        PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
        assertThatThrownBy(() -> new PersonalStorageReadinessController(gateway).readiness())
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        verifyNoInteractions(gateway);
    }
}
