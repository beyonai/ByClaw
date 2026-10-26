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

/** New service APIs carry real HTTP status and stable public codes, never raw database/provider messages. */
@Order(org.springframework.core.Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes=TenantInternalController.class)
public class TenantInternalExceptionHandler {
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
        ProblemDetail problem=ProblemDetail.forStatus(status);
        problem.setTitle("Internal tenant request failed");problem.setProperty("errorCode",code);
        problem.setProperty("traceId",UUID.randomUUID().toString());
        return ResponseEntity.status(status).body(problem);
    }
}
