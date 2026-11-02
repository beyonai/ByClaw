package com.iwhalecloud.byai.manager.domain.operations;

import com.iwhalecloud.byai.state.infrastructure.filter.AccessTokenVerifyInterceptor;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

/** 固定服务端点优先于 Cookie 和匿名配置。
 * @author Codex
 * @since 2026-10-23
 */
class OperationsAuthenticationTest {
    /** 默认关闭；短令牌和普通用户令牌都不能进入。 */
    @Test
    void tokenIsRequiredEvenWithSessionOrWrongMethod() {
        OperationsAuthentication authentication = new OperationsAuthentication();
        assertThat(authentication.accepts("anything")).isFalse();
        String token = "test-only-operations-token-32-characters";
        ReflectionTestUtils.setField(authentication, "token", token);
        assertThat(authentication.accepts(token)).isTrue();
        assertThat(authentication.accepts(token + "x")).isFalse();
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        ReflectionTestUtils.setField(interceptor, "operationsAuthentication", authentication);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", OperationsAuthentication.PATH);
        request.setServletPath(OperationsAuthentication.PATH);
        request.getSession().setAttribute("SHARE_CURRENT_USER", "{\"userCode\":\"admin\"}");
        MockHttpServletResponse denied = new MockHttpServletResponse();
        assertThat(interceptor.preHandle(request, denied, new Object())).isFalse();
        assertThat(denied.getStatus()).isEqualTo(401);
        request.addHeader(OperationsAuthentication.HEADER, token);
        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object())).isTrue();
        request.setMethod("GET");
        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object())).isFalse();
    }
}

