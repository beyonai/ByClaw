package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException;
import com.iwhalecloud.byai.manager.domain.tenant.integration.TenantCommandException;
import java.util.UUID;
import org.springframework.core.annotation.Order;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** New service APIs carry real HTTP status and stable public codes, never raw database/provider messages. */
@Order(org.springframework.core.Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes=TenantInternalController.class)
public class TenantInternalExceptionHandler {
    private static final Logger LOG=LoggerFactory.getLogger(TenantInternalExceptionHandler.class);
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handle(Exception error) {
        int status=503;String code="INTEGRATION_UNAVAILABLE";
        if(error instanceof TenantCommandException command) { status=command.status();code=command.getMessage(); }
        else if(error instanceof InternalServiceSecurityException auth) { status=auth.status();code=auth.getMessage(); }
        else if(error instanceof ResponseStatusException response) {
            status=response.getStatusCode().value();
            String reason=response.getReason();
            code=reason!=null&&reason.matches("[A-Z][A-Z0-9_]{1,79}")?reason:"REQUEST_REJECTED";
        } else if(error instanceof IllegalArgumentException || error instanceof org.springframework.http.converter.HttpMessageNotReadableException
            || error instanceof org.springframework.web.bind.MissingServletRequestParameterException) { status=400;code="INVALID_REQUEST"; }
        // Public codes and log fields must never inherit a raw database/provider exception message.
        code=code!=null&&code.matches("[A-Z][A-Z0-9_]{1,79}")?code:"REQUEST_REJECTED";
        String traceId=UUID.randomUUID().toString();
        if(status>=500) {
            LOG.error("Internal tenant request failed status={} errorCode={} exceptionType={} traceId={}",
                status,code,error.getClass().getName(),traceId);
        } else if(status==404 && "COMMAND_NOT_FOUND".equals(code)) {
            // Absence is expected when reconciling an idempotency key before the first submission.
            LOG.debug("Internal tenant command absent status={} errorCode={} exceptionType={} traceId={}",
                status,code,error.getClass().getName(),traceId);
        } else {
            LOG.warn("Internal tenant request rejected status={} errorCode={} exceptionType={} traceId={}",
                status,code,error.getClass().getName(),traceId);
        }
        ProblemDetail problem=ProblemDetail.forStatus(status);
        problem.setTitle("Internal tenant request failed");problem.setProperty("errorCode",code);
        problem.setProperty("traceId",traceId);
        return ResponseEntity.status(status).body(problem);
    }
}
