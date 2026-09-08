package com.iwhalecloud.byai.manager.interfaces.controller.user;

import com.iwhalecloud.byai.manager.domain.mail.MailConnectionCheckAdmissionService;
import com.iwhalecloud.byai.manager.domain.mail.MailConnectionCheckLeaseService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Mail-check-only safe errors, intentionally avoiding request-body logging. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = MailConnectionCheckController.class)
public class MailConnectionCheckExceptionHandler {

    private static final String INVALID = "Invalid mail connection check request";
    private static final String BUSY = "Mail connection check is already running";
    private static final String UNAVAILABLE = "Mail connection check is temporarily unavailable";

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentNotValidException.class,
        IllegalArgumentException.class})
    public ResponseEntity<ResponseUtil<Object>> invalidRequest(Exception ignored) {
        return ResponseEntity.badRequest().body(ResponseUtil.fail(INVALID));
    }

    @ExceptionHandler(MailConnectionCheckAdmissionService.BusyException.class)
    public ResponseEntity<ResponseUtil<Object>> busy(RuntimeException ignored) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ResponseUtil.fail(BUSY));
    }

    @ExceptionHandler({MailConnectionCheckAdmissionService.UnavailableException.class,
        MailConnectionCheckAdmissionService.LeaseLostException.class,
        MailConnectionCheckLeaseService.LeaseUnavailableException.class,
        MailConnectionCheckLeaseService.LeaseLostException.class})
    public ResponseEntity<ResponseUtil<Object>> unavailable(RuntimeException ignored) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(ResponseUtil.fail(UNAVAILABLE));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ResponseUtil<Object>> unexpected(Exception ignored) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(ResponseUtil.fail(UNAVAILABLE));
    }
}
