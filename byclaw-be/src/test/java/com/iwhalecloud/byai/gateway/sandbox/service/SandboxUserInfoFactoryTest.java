package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;

class SandboxUserInfoFactoryTest {

    @Mock
    private LoginApplicationService loginApplicationService;

    private AutoCloseable mocks;

    private SandboxUserInfoFactory factory;

    @BeforeEach
    void setUp() {
        mocks = MockitoAnnotations.openMocks(this);
        factory = new SandboxUserInfoFactory(loginApplicationService);
    }

    @AfterEach
    void tearDown() throws Exception {
        CurrentUserHolder.clearLoginInfo();
        mocks.close();
    }

    @Test
    void build_usesCurrentLoginInfoWhenUserIdentityIsComplete() {
        LoginInfo currentLoginInfo = new LoginInfo();
        currentLoginInfo.setUserId(10001L);
        currentLoginInfo.setUserCode("demo-user");
        currentLoginInfo.setUserName("Demo User");
        currentLoginInfo.setSessionId("session-001");
        CurrentUserHolder.setLoginInfo(currentLoginInfo);

        Map<String, Object> userInfo = factory.build("ignored-user");

        assertThat(userInfo)
            .containsEntry("userId", 10001L)
            .containsEntry("userCode", "demo-user")
            .containsEntry("userName", "Demo User")
            .containsEntry("sessionId", "session-001");
        verify(loginApplicationService, never()).getLoginInfo("demo-user");
    }

    @Test
    void build_queriesLoginInfoByUserCodeWhenCurrentUserIdIsMissing() {
        LoginInfo currentLoginInfo = new LoginInfo();
        currentLoginInfo.setUserCode("demo-user");
        currentLoginInfo.setSessionId("session-002");
        CurrentUserHolder.setLoginInfo(currentLoginInfo);

        LoginInfo dbLoginInfo = new LoginInfo();
        dbLoginInfo.setUserId(10002L);
        dbLoginInfo.setUserCode("demo-user");
        dbLoginInfo.setUserName("Demo User");
        dbLoginInfo.setAssistantId(20002L);
        when(loginApplicationService.getLoginInfo("demo-user")).thenReturn(dbLoginInfo);

        Map<String, Object> userInfo = factory.build("demo-user");

        assertThat(userInfo)
            .containsEntry("userId", 10002L)
            .containsEntry("userCode", "demo-user")
            .containsEntry("userName", "Demo User")
            .containsEntry("assistantId", 20002L)
            .containsEntry("sessionId", "session-002");
    }

    @Test
    void build_usesFallbackUserCodeWhenLookupFails() {
        when(loginApplicationService.getLoginInfo("demo-user")).thenThrow(new IllegalArgumentException("not found"));

        Map<String, Object> userInfo = factory.build("demo-user");

        assertThat(userInfo)
            .containsEntry("userCode", "demo-user")
            .containsEntry("userId", "")
            .containsEntry("paramMap", Map.of());
    }
}
