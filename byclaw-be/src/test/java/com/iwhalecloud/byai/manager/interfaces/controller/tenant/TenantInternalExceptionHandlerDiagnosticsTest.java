package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.iwhalecloud.byai.manager.domain.tenant.integration.TenantCommandException;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import static org.junit.jupiter.api.Assertions.*;

class TenantInternalExceptionHandlerDiagnosticsTest {
    @Test void absentCommandRemains404AndOnlyLogsAtDebug() {
        assertLogged(new TenantCommandException(404, "COMMAND_NOT_FOUND"), 404, "COMMAND_NOT_FOUND", Level.DEBUG);
    }

    @Test void absentRecoveryReceiptRemains404AndOnlyLogsAtDebug() {
        assertLogged(new TenantCommandException(404, "RECOVERY_NOT_FOUND"), 404, "RECOVERY_NOT_FOUND", Level.DEBUG);
    }

    @Test void serverFailureIsNotSilencedByRecoveryNotFoundCode() {
        assertLogged(new TenantCommandException(503, "RECOVERY_NOT_FOUND"), 503, "RECOVERY_NOT_FOUND", Level.ERROR);
    }

    @Test void serverFailureIsNotSilencedByCommandNotFoundCode() {
        assertLogged(new TenantCommandException(503, "COMMAND_NOT_FOUND"), 503, "COMMAND_NOT_FOUND", Level.ERROR);
    }

    @Test void infrastructureFailureLogsOnlyClassAndTheResponseTraceId() {
        assertLogged(new IllegalStateException("redis://private-user:private-password@private-host"),
            503, "INTEGRATION_UNAVAILABLE", Level.ERROR);
    }

    @Test void businessDenialRetainsItsStatusAndStableCode() {
        assertLogged(new TenantCommandException(409, "REQUEST_ID_CONFLICT"), 409, "REQUEST_ID_CONFLICT", Level.WARN);
    }

    @Test void nonCodeExceptionMessageNeverReachesResponseOrLogs() {
        assertLogged(new TenantCommandException(409, "redis://private-user:private-password@private-host"),
            409, "REQUEST_REJECTED", Level.WARN);
    }

    private void assertLogged(Exception error, int status, String code, Level level) {
        Logger logger = (Logger) LoggerFactory.getLogger(TenantInternalExceptionHandler.class);
        Level previousLevel = logger.getLevel();
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.DEBUG);
        try {
            var response = new TenantInternalExceptionHandler().handle(error);
            assertEquals(status, response.getStatusCode().value());
            var problem = response.getBody();
            assertNotNull(problem);
            assertNotNull(problem.getProperties());
            assertEquals(code, problem.getProperties().get("errorCode"));
            String traceId = (String) problem.getProperties().get("traceId");
            assertNotNull(traceId);
            assertFalse(traceId.isBlank());
            assertEquals(1, appender.list.size());
            var event = appender.list.get(0);
            assertEquals(level, event.getLevel());
            String message = event.getFormattedMessage();
            assertTrue(message.contains("traceId=" + traceId));
            assertTrue(message.contains("status=" + status));
            assertTrue(message.contains("errorCode=" + code));
            assertTrue(message.contains("exceptionType=" + error.getClass().getName()));
            assertFalse(message.contains("private-"));
            assertFalse(problem.toString().contains("private-"));
            assertNull(event.getThrowableProxy());
        } finally {
            logger.detachAppender(appender);
            logger.setLevel(previousLevel);
            appender.stop();
        }
    }
}
