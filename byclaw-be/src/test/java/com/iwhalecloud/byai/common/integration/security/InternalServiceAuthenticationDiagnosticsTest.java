package com.iwhalecloud.byai.common.integration.security;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class InternalServiceAuthenticationDiagnosticsTest {
    private static final String SECRET = "test-only-diagnostic-signing-material-32-bytes";
    private final ObjectMapper mapper = new ObjectMapper();
    private final InternalServiceSecurityProperties properties = new InternalServiceSecurityProperties();

    private InternalServiceAuthenticator verifier(InternalServiceNonceStore nonces) {
        properties.setEnabled(true);
        var client = new InternalServiceSecurityProperties.Client();
        client.setSecret(SECRET);
        client.setSourceSystem("HACU");
        client.setScopes(Set.of("tenant:read"));
        client.setEnterpriseIds(Set.of("42"));
        properties.getClients().put("hacu", client);
        return new InternalServiceAuthenticator(properties, nonces,
            Clock.fixed(Instant.ofEpochSecond(1000), ZoneOffset.UTC));
    }

    private MockHttpServletRequest request(byte[] body) {
        var request = new MockHttpServletRequest("GET", "/internal/v1/tenants/42/runtime");
        request.setContent(body);
        request.addHeader("X-ByClaw-Client-Id", "hacu");
        request.addHeader("X-ByClaw-Timestamp", "1000");
        request.addHeader("X-ByClaw-Nonce", "diagnostic-nonce-123456");
        request.addHeader("X-ByClaw-Signature", InternalServiceAuthenticator.sign(SECRET,
            InternalServiceAuthenticator.canonical(request, body)));
        return request;
    }

    private MockHttpServletResponse reject(InternalServiceAuthenticator verifier, MockHttpServletRequest request)
        throws Exception {
        var response = new MockHttpServletResponse();
        new InternalServiceAuthenticationFilter(verifier, mapper).doFilter(request, response,
            (a, b) -> fail("Rejected authentication reached the controller"));
        return response;
    }

    private void assertDiagnostic(MockHttpServletResponse response, CapturedLogs logs, Level level, String reason)
        throws Exception {
        assertEquals(401, response.getStatus());
        var problem = mapper.readTree(response.getContentAsString());
        assertEquals("SERVICE_AUTH_INVALID", problem.path("errorCode").asText());
        assertFalse(problem.has("diagnosticReason"));
        assertEquals(1, logs.appender.list.size());
        ILoggingEvent event = logs.appender.list.get(0);
        assertEquals(level, event.getLevel());
        String traceId = problem.path("traceId").asText();
        assertFalse(traceId.isBlank());
        assertTrue(event.getFormattedMessage().contains("traceId=" + traceId));
        assertTrue(event.getFormattedMessage().contains("reason=" + reason));
        assertTrue(event.getFormattedMessage().contains("status=401"));
        assertTrue(event.getFormattedMessage().contains("method=GET"));
        assertTrue(event.getFormattedMessage().contains("path=/internal/v1/tenants/{id}/runtime"));
        // Exception messages and stack traces may contain connection credentials.
        assertNull(event.getThrowableProxy());
    }

    @Test void disabledIntegrationLogsWarningWithTheResponseTraceId() throws Exception {
        var verifier = verifier((key, ttl) -> fail("Disabled authentication reached nonce storage"));
        properties.setEnabled(false);
        try (var logs = new CapturedLogs()) {
            assertDiagnostic(reject(verifier, request(new byte[0])), logs, Level.WARN, "INTEGRATION_DISABLED");
        }
    }

    @Test void signatureMismatchLogsOnlySafeRouteAndDiagnosticFields() throws Exception {
        var verifier = verifier((key, ttl) -> fail("Invalid signature reached nonce storage"));
        byte[] body = "private-request-body".getBytes(StandardCharsets.UTF_8);
        var request = request(body);
        request.setQueryString("token=private-query-value");
        request.removeHeader("X-ByClaw-Signature");
        String signature = "0".repeat(64);
        request.addHeader("X-ByClaw-Signature", signature);
        try (var logs = new CapturedLogs()) {
            assertDiagnostic(reject(verifier, request), logs, Level.WARN, "SIGNATURE_MISMATCH");
            String message = logs.appender.list.get(0).getFormattedMessage();
            for (String sensitive : Set.of(SECRET, signature, "diagnostic-nonce-123456", "private-request-body",
                "private-query-value", "token=", "X-ByClaw-", "hacu")) {
                assertFalse(message.contains(sensitive), sensitive);
            }
        }
    }

    @Test void redisFailureLogsErrorWithoutConnectionDetailsAndStillDenies() throws Exception {
        var verifier = verifier((key, ttl) -> {
            throw new RedisConnectionFailureException("redis://private-user:private-password@private-host:6379");
        });
        try (var logs = new CapturedLogs()) {
            assertDiagnostic(reject(verifier, request(new byte[0])), logs, Level.ERROR, "NONCE_STORE_UNAVAILABLE");
            String message = logs.appender.list.get(0).getFormattedMessage();
            for (String sensitive : Set.of("redis://", "private-user", "private-password", "private-host", SECRET,
                "diagnostic-nonce-123456")) {
                assertFalse(message.contains(sensitive), sensitive);
            }
        }
    }

    @Test void malformedClientIdentifierIsNotWrittenToLogs() throws Exception {
        var verifier = verifier((key, ttl) -> fail("Invalid identity reached nonce storage"));
        var request = request(new byte[0]);
        request.removeHeader("X-ByClaw-Client-Id");
        request.addHeader("X-ByClaw-Client-Id", "untrusted-client-value!");
        try (var logs = new CapturedLogs()) {
            assertDiagnostic(reject(verifier, request), logs, Level.WARN, "HEADER_INVALID");
            assertFalse(logs.appender.list.get(0).getFormattedMessage().contains("untrusted-client-value"));
        }
    }

    @Test void nonceReplayRemainsAWarningAndDeniesAccess() throws Exception {
        var verifier = verifier((key, ttl) -> false);
        try (var logs = new CapturedLogs()) {
            assertDiagnostic(reject(verifier, request(new byte[0])), logs, Level.WARN, "NONCE_REPLAYED");
        }
    }

    @Test void scopeDenialKeepsItsStatusAndDoesNotExposeConfiguredAuthorities() throws Exception {
        var verifier = verifier((key, ttl) -> fail("Unauthorized request reached nonce storage"));
        properties.getClients().get("hacu").setScopes(Set.of("private-configured-scope"));
        try (var logs = new CapturedLogs()) {
            var response = reject(verifier, request(new byte[0]));
            assertEquals(403, response.getStatus());
            assertEquals("SERVICE_SCOPE_DENIED", mapper.readTree(response.getContentAsString()).path("errorCode").asText());
            assertEquals(1, logs.appender.list.size());
            assertEquals(Level.WARN, logs.appender.list.get(0).getLevel());
            assertFalse(logs.appender.list.get(0).getFormattedMessage().contains("private-configured-scope"));
        }
    }

    @Test void nonCodeDownstreamSecurityMessageIsNotExposed() throws Exception {
        var filter = new InternalServiceAuthenticationFilter(verifier((key, ttl) -> true), mapper);
        var response = new MockHttpServletResponse();
        try (var logs = new CapturedLogs()) {
            filter.doFilter(request(new byte[0]), response, (a, b) -> {
                throw new InternalServiceSecurityException(400, "private-downstream-value");
            });
            assertEquals(400, response.getStatus());
            assertEquals("REQUEST_REJECTED", mapper.readTree(response.getContentAsString()).path("errorCode").asText());
            assertFalse(logs.appender.list.get(0).getFormattedMessage().contains("private-downstream-value"));
        }
    }

    @Test void unrelatedDownstreamFailureStillPropagatesWithoutAuthenticationLog() throws Exception {
        var verifier = verifier((key, ttl) -> true);
        var request = request(new byte[0]);
        var filter = new InternalServiceAuthenticationFilter(verifier, mapper);
        var failure = new IOException("downstream-failure");
        try (var logs = new CapturedLogs()) {
            assertSame(failure, assertThrows(IOException.class,
                () -> filter.doFilter(request, new MockHttpServletResponse(), (a, b) -> { throw failure; })));
            assertTrue(logs.appender.list.isEmpty());
            assertNull(request.getAttribute(InternalServicePrincipal.ATTRIBUTE));
        }
    }

    /** Capture only this filter's logger and restore its previous configuration after each assertion. */
    private static final class CapturedLogs implements AutoCloseable {
        private final Logger logger = (Logger) LoggerFactory.getLogger(InternalServiceAuthenticationFilter.class);
        private final Level previousLevel = logger.getLevel();
        private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

        private CapturedLogs() {
            appender.start();
            logger.addAppender(appender);
            logger.setLevel(Level.WARN);
        }

        @Override public void close() {
            logger.detachAppender(appender);
            logger.setLevel(previousLevel);
            appender.stop();
        }
    }
}
