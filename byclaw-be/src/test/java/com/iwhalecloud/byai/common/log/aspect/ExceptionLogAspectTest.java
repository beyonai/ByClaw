package com.iwhalecloud.byai.common.log.aspect;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.iwhalecloud.byai.manager.domain.log.service.LogExceptionInfoService;
import com.iwhalecloud.byai.manager.domain.tenant.integration.TenantCommandException;
import com.iwhalecloud.byai.manager.interfaces.controller.tenant.TenantInternalController;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Created by Codex on 2026-10-28: expected command misses must not become error incidents. */
class ExceptionLogAspectTest {
    @Test void deniedToolBootstrapKeepsAuditWithoutCredentialsOrChangingRequest() throws Throwable {
        var keys = java.util.Map.of("hostPrivateKeyBase64", "fixture-host-private", "authorizedKey", "fixture-public");
        var body = java.util.Map.of("userCode", "target", "toolEnvironmentKeys", keys);
        var request = new org.springframework.mock.web.MockHttpServletRequest("POST", "/sandbox/launchByUserCode");
        request.addHeader("Authorization", "Bearer fixture-auth");
        request.addHeader("Beyond-Token", "fixture-beyond");
        request.addHeader("X-Request-ID", "safe-request-id");
        org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(
            new org.springframework.web.context.request.ServletRequestAttributes(request));
        var point = mock(ProceedingJoinPoint.class);
        var failure = new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN);
        when(point.proceed()).thenThrow(failure);
        when(point.getArgs()).thenReturn(new Object[]{body});
        var signature = mock(MethodSignature.class);
        when(signature.getDeclaringTypeName()).thenReturn("SandboxController");
        when(signature.getName()).thenReturn("launchByUserCode");
        when(point.getSignature()).thenReturn(signature);
        var sink = mock(LogExceptionInfoService.class);
        var aspect = new ExceptionLogAspect();
        ReflectionTestUtils.setField(aspect, "logExceptionInfoService", sink);
        try {
            assertSame(failure, assertThrows(Exception.class, () -> aspect.around(point)));
            var saved = org.mockito.ArgumentCaptor.forClass(com.iwhalecloud.byai.manager.entity.log.LogExceptionInfo.class);
            verify(sink).save(saved.capture());
            String recorded = saved.getValue().getRequestBody() + saved.getValue().getRequestHeader();
            assertTrue(recorded.contains("target"));
            assertTrue(recorded.contains("safe-request-id"));
            for (String secret : java.util.List.of("fixture-host-private", "fixture-public", "fixture-auth", "fixture-beyond")) {
                assertFalse(recorded.contains(secret), "Audit contains a credential fixture");
            }
            assertEquals(keys, body.get("toolEnvironmentKeys"));
        } finally {
            org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
        }
    }

    @Test void commandLookupMissPreservesExceptionWithoutErrorLogOrIncident() throws Throwable {
        assertLogging(new TenantCommandException(404, "COMMAND_NOT_FOUND"), true, false);
    }

    @Test void serverFailureWithSameCodeStillCreatesErrorIncident() throws Throwable {
        assertLogging(new TenantCommandException(503, "COMMAND_NOT_FOUND"), true, true);
    }

    @Test void otherControllerIsNotSilencedByMatchingMessage() throws Throwable {
        assertLogging(new TenantCommandException(404, "COMMAND_NOT_FOUND"), false, true);
    }

    @Test void unrelatedTenantFailureStillCreatesErrorIncident() throws Throwable {
        assertLogging(new IllegalStateException("database unavailable"), true, true);
    }

    private void assertLogging(Exception failure, boolean tenantController, boolean incident) throws Throwable {
        var point = mock(ProceedingJoinPoint.class);
        when(point.getTarget()).thenReturn(tenantController ? mock(TenantInternalController.class) : new Object());
        when(point.proceed()).thenThrow(failure);
        var signature = mock(MethodSignature.class);
        when(signature.getDeclaringTypeName()).thenReturn("TestController");
        when(signature.getName()).thenReturn("byRequest");
        when(point.getSignature()).thenReturn(signature);
        var sink = mock(LogExceptionInfoService.class);
        var aspect = new ExceptionLogAspect();
        ReflectionTestUtils.setField(aspect, "logExceptionInfoService", sink);
        Logger logger = (Logger) LoggerFactory.getLogger(ExceptionLogAspect.class);
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        Level previous = logger.getLevel();
        logger.setLevel(Level.ERROR);
        try {
            assertSame(failure, assertThrows(Exception.class, () -> aspect.around(point)));
            assertEquals(incident ? 1 : 0, appender.list.size());
            if (incident) {
                verify(sink).save(any());
            } else {
                verifyNoInteractions(sink);
            }
        } finally {
            logger.detachAppender(appender);
            logger.setLevel(previous);
            appender.stop();
        }
    }
}
