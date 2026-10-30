package com.iwhalecloud.byai.common.integration.security;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

class InternalServiceAuthenticationTest {
    private final InternalServiceSecurityProperties properties = new InternalServiceSecurityProperties();
    private InternalServiceAuthenticator verifier() {
        properties.setEnabled(true);
        var client = new InternalServiceSecurityProperties.Client();
        client.setSecret("test-only-signing-material-at-least-32-bytes");
        client.setSourceSystem("HACU");
        client.setScopes(Set.of("tenant:read"));
        client.setEnterpriseIds(Set.of("42"));
        properties.getClients().put("hacu", client);
        Set<String> seen = new java.util.HashSet<>();
        return new InternalServiceAuthenticator(properties, (key, ttl) -> seen.add(key),
            Clock.fixed(Instant.ofEpochSecond(1000), ZoneOffset.UTC));
    }
    private MockHttpServletRequest request(String nonce) {
        var r = new MockHttpServletRequest("GET", "/internal/v1/tenants/42/runtime");
        r.addHeader("X-ByClaw-Client-Id", "hacu");
        r.addHeader("X-ByClaw-Timestamp", "1000");
        r.addHeader("X-ByClaw-Nonce", nonce);
        r.addHeader("X-ByClaw-Signature", InternalServiceAuthenticator.sign("test-only-signing-material-at-least-32-bytes",
            InternalServiceAuthenticator.canonical(r, new byte[0])));
        return r;
    }
    @Test void authenticatesImmutableScopedIdentityAndRejectsReplay() {
        var verifier = verifier(); var r = request("nonce-value-123456");
        var p = verifier.authenticate(r, new byte[0]);
        assertEquals("HACU", p.sourceSystem());
        p.requireScope("tenant:read"); p.requireSource("HACU"); p.requireTenant("42");
        assertThrows(RuntimeException.class, () -> p.requireTenant("43"));
        assertThrows(RuntimeException.class, () -> p.requireSource("other"));
        assertThrows(RuntimeException.class, () -> p.requireScope("tenant:provision"));
        assertThrows(UnsupportedOperationException.class, () -> p.scopes().add("anything"));
        assertThrows(RuntimeException.class, () -> verifier.authenticate(r, new byte[0]));
    }
    @Test void rejectsBodyQueryTimestampAndCookieOnly() {
        var verifier = verifier(); var r = request("nonce-value-654321");
        assertThrows(RuntimeException.class, () -> verifier.authenticate(r, "changed".getBytes()));
        r.setQueryString("x=changed");
        assertThrows(RuntimeException.class, () -> verifier.authenticate(r, new byte[0]));
        r.setQueryString(null); r.removeHeader("X-ByClaw-Timestamp"); r.addHeader("X-ByClaw-Timestamp", "1");
        assertThrows(RuntimeException.class, () -> verifier.authenticate(r, new byte[0]));
        assertThrows(RuntimeException.class, () -> verifier.authenticate(new MockHttpServletRequest(), new byte[0]));
    }
    @Test void correctlySignedRequestWithUndersizedConfiguredSecretIsDenied() {
        var verifier = verifier();
        properties.getClients().get("hacu").setSecret("short-test-key");
        var signed = request("weak-key-nonce-12345");
        signed.removeHeader("X-ByClaw-Signature");
        signed.addHeader("X-ByClaw-Signature", InternalServiceAuthenticator.sign("short-test-key",
            InternalServiceAuthenticator.canonical(signed, new byte[0])));
        assertThrows(InternalServiceSecurityException.class, () -> verifier.authenticate(signed, new byte[0]));
    }
    @Test void disabledWrongKeyAndUrlTargetFailClosed() {
        var verifier = verifier();
        properties.setEnabled(false);
        assertThrows(InternalServiceSecurityException.class, () -> verifier.authenticate(request("nonce-value-777777"), new byte[0]));
        properties.setEnabled(true);
        properties.getClients().get("hacu").setSecret("different-test-key");
        assertThrows(InternalServiceSecurityException.class, () -> verifier.authenticate(request("nonce-value-888888"), new byte[0]));
        properties.getClients().get("hacu").setSecret("test-only-signing-material-at-least-32-bytes");
        var target = request("nonce-value-999999");
        target.setRequestURI("/internal/v1/tenants/43/runtime");
        target.removeHeader("X-ByClaw-Signature");
        target.addHeader("X-ByClaw-Signature", InternalServiceAuthenticator.sign("test-only-signing-material-at-least-32-bytes",
            InternalServiceAuthenticator.canonical(target, new byte[0])));
        assertEquals(403, assertThrows(InternalServiceSecurityException.class,
            () -> verifier.authenticate(target, new byte[0])).status());
    }
    @Test void filterReturnsProblemDetailsAndRetainsBodyWithoutLeakingPrincipal() throws Exception {
        var globalMapper = new com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration()
            .jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder());
        var filter = new InternalServiceAuthenticationFilter(verifier(), globalMapper);
        var denied = new org.springframework.mock.web.MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("GET", "/internal/v1/tenants/42/runtime"), denied,
            (a, b) -> fail("Unauthenticated request reached controller"));
        assertEquals(401, denied.getStatus());
        assertTrue(denied.getContentAsString().contains("errorCode"));
        assertTrue(denied.getContentAsString().contains("traceId"));
        var problem = new com.fasterxml.jackson.databind.ObjectMapper().readTree(denied.getContentAsString());
        assertTrue(problem.path("status").isIntegralNumber());
        assertEquals(401, problem.path("status").intValue());
        assertEquals("SERVICE_AUTH_INVALID", problem.path("errorCode").textValue());
        assertTrue(problem.path("traceId").isTextual());
        var signed = request("nonce-filter-123456");
        filter.doFilter(signed, new org.springframework.mock.web.MockHttpServletResponse(), (a, b) -> {
            assertEquals("hacu", InternalServicePrincipal.require((jakarta.servlet.http.HttpServletRequest) a).clientId());
            assertArrayEquals(new byte[0], a.getInputStream().readAllBytes());
        });
        assertNull(signed.getAttribute(InternalServicePrincipal.ATTRIBUTE));
        var invalid = request("nonce-invalid-body-12345");
        var rejected = new org.springframework.mock.web.MockHttpServletResponse();
        filter.doFilter(invalid, rejected, (a, b) -> {
            throw new InternalServiceSecurityException(400, "INVALID_REQUEST");
        });
        assertEquals(400, rejected.getStatus());
        var badRequest = new com.fasterxml.jackson.databind.ObjectMapper().readTree(rejected.getContentAsString());
        assertTrue(badRequest.path("status").isIntegralNumber());
        assertEquals(400, badRequest.path("status").intValue());
        assertEquals("INVALID_REQUEST", badRequest.path("errorCode").textValue());
    }
    @org.springframework.web.bind.annotation.RestController
    static class ProbeController {
        @org.springframework.web.bind.annotation.GetMapping("/internal/v1/tenants/42/runtime")
        String runtime(jakarta.servlet.http.HttpServletRequest request) {
            return InternalServicePrincipal.require(request).sourceSystem();
        }
    }
    @Test void signedRequestPassesBrowserFiltersAndTenantMvcInterceptors() throws Exception {
        var filter = new InternalServiceAuthenticationFilter(verifier(), new com.fasterxml.jackson.databind.ObjectMapper());
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(new ProbeController())
            .addFilters(filter, new com.iwhalecloud.byai.state.common.filter.SignAntiReplayFilter(),
                new com.iwhalecloud.byai.state.common.filter.xss.XssFilter())
            .addInterceptors(new com.iwhalecloud.byai.state.infrastructure.filter.AccessTokenVerifyInterceptor(),
                new com.iwhalecloud.byai.manager.domain.tenant.TenantContextInterceptor(null))
            .build();
        var signed = request("mvc-nonce-12345678");
        var builder = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(signed.getRequestURI())
            .header("X-Enterprise-Id", "999")
            .cookie(new jakarta.servlet.http.Cookie("JSESSIONID", "irrelevant-browser-cookie"));
        for (String suffix : Set.of("Client-Id", "Timestamp", "Nonce", "Signature")) {
            builder.header("X-ByClaw-" + suffix, signed.getHeader("X-ByClaw-" + suffix));
        }
        mvc.perform(builder).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().string("HACU"));
    }
    @Test void routesDoNotCaptureExistingNodeInternalEndpoints() {
        assertTrue(InternalServiceRoutes.matches("GET", "/internal/v1/commands/by-request"));
        assertEquals("tenant:manage", InternalServiceRoutes.scope("PUT", "/internal/v1/tenants/42/enterprise"));
        assertEquals("tenant:manage", InternalServiceRoutes.scope("POST", "/internal/v1/tenants/42/members"));
        assertEquals("tenant:manage", InternalServiceRoutes.scope("POST", "/internal/v1/shared-workspaces/999/members"));
        assertFalse(InternalServiceRoutes.matches("GET", "/internal/v1/shared-workspaces/999/members"));
        assertEquals("tenant:read", InternalServiceRoutes.scope("GET", "/internal/v1/tenants/42/members"));
        assertFalse(InternalServiceRoutes.matches("DELETE", "/internal/v1/tenants/42/members"));
        assertFalse(InternalServiceRoutes.matches("POST", "/internal/v1/tenantSchemaTaskReports"));
        assertFalse(InternalServiceRoutes.matches("GET", "/internal/v1/tenants/42/schema/current"));
        assertFalse(InternalServiceRoutes.matches("GET", "/internal/v1/tenants/42/runtime/extra"));
    }
    @Test void recoveryRoutesHaveExactScopeAndUuidBoundaries() {
        assertEquals("tenant:read",InternalServiceRoutes.scope("GET","/internal/v1/commands/7/recovery"));
        assertEquals("tenant:provision",InternalServiceRoutes.scope("POST","/internal/v1/commands/7/recoveries"));
        assertEquals("tenant:read",InternalServiceRoutes.scope("GET","/internal/v1/commands/7/recovery-requests/11111111-1111-4111-8111-111111111111"));
        assertFalse(InternalServiceRoutes.matches("GET","/internal/v1/commands/7/recovery-requests/not-a-uuid"));
        assertFalse(InternalServiceRoutes.matches("POST","/internal/v1/commands/7/recovery"));
        assertFalse(InternalServiceRoutes.matches("GET","/internal/v1/commands/7/recovery/extra"));
    }

}
