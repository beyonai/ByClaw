package com.iwhalecloud.byai.state.infrastructure.filter;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class AccessTokenVerifyInterceptorTest {

    @Test
    void allowsAnonymousSystemConfigurationQueries() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        interceptor.init();

        assertTrue(interceptor.checkUrlByRegex(
            "http://localhost:8086/system/session/getDcSystemConfigValueByCodes"));
        assertTrue(interceptor.checkUrlByRegex(
            "http://localhost:8086/system/staticdata/getDcSystemConfig"));
        assertFalse(interceptor.checkUrlByRegex(
            "http://localhost:8086/system/session/currentUser"));
    }
}
