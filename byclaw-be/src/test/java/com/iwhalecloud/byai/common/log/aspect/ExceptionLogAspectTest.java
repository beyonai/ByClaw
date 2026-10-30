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
