package com.iwhalecloud.byai.state.application.service.asr;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class HarnessMediaAuthorizationServiceTest {
    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }

    @Test
    void sessionAuthenticatedRequestsUseTheCurrentSharedToken() {
        LoginInfo login = new LoginInfo();
        login.setUserId(42L);
        CurrentUserHolder.setLoginInfo(login);
        try (var redis = Mockito.mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.hmGet("user:42:login:auth", "Beyond-Token")).thenReturn("test-shared-token");
            assertThat(new HarnessMediaAuthorizationService().currentToken()).isEqualTo("test-shared-token");
            redis.verify(() -> RedisUtil.hmGet("user:42:login:auth", "Beyond-Token"));
        }
    }

    @Test
    void missingUserOrSharedTokenIsRejected() {
        assertThatThrownBy(() -> new HarnessMediaAuthorizationService().currentToken()).hasMessageContaining("401");
        LoginInfo login = new LoginInfo();
        login.setUserId(42L);
        CurrentUserHolder.setLoginInfo(login);
        try (var redis = Mockito.mockStatic(RedisUtil.class)) {
            assertThatThrownBy(() -> new HarnessMediaAuthorizationService().currentToken()).hasMessageContaining("503");
        }
    }
}
