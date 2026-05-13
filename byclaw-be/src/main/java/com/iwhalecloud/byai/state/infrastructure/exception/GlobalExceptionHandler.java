package com.iwhalecloud.byai.state.infrastructure.exception;

import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.support.DefaultMessageSourceResolvable;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.util.ContentCachingRequestWrapper;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.log.exception.BaseRuntimeException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.ConstraintViolationException;

/**
 * 全局异常处理（统一 {@link ResponseUtil}：失败 code=-1，成功 code=0，字段 msg / data）
 */
@Order(999999)
@RestControllerAdvice(annotations = {
    RestController.class, Controller.class
})
public class GlobalExceptionHandler {
    private static final Logger logger = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    public static final int NO_FOUND_ERROR_CODE = 404;

    @Value("${exception.log.sysCode:}")
    private String sysCode;

    @ExceptionHandler(value = BaseRuntimeException.class)
    public void baseExceptionHandler(HttpServletResponse response, BaseRuntimeException baseRuntimeException)
        throws IOException {
        logger.error("BaseRuntimeException occurred:{}", baseRuntimeException);
        String msg;
        if (baseRuntimeException.getErrorThrowable() != null && baseRuntimeException.getErrorService() != null) {
            try {
                msg = I18nUtil.get(baseRuntimeException.getErrorService(),
                    baseRuntimeException.getErrorThrowable().getMessage());
            }
            catch (Exception e) {
                msg = baseRuntimeException.getErrorThrowable().getMessage();
            }
        }
        else {
            msg = baseRuntimeException.getErrorMsg();
        }
        if (baseRuntimeException.getErrorService() != null) {
            msg = msg + " [" + baseRuntimeException.getErrorService() + "]";
        }
        ResponseUtil<Object> body = ResponseUtil.fail(msg);
        String contentType = response.getContentType();
        if (contentType != null && !contentType.contains("text/event-stream")) {
            response.getOutputStream().write(JSON.toJSONString(body).getBytes(StandardCharsets.UTF_8));
        }
        else {
            response.setContentType("application/json;charset=UTF-8");
            response.setStatus(HttpServletResponse.SC_OK);
            response.getOutputStream().write(JSON.toJSONString(body).getBytes(StandardCharsets.UTF_8));
        }
    }

    @ExceptionHandler(value = Exception.class)
    public ResponseEntity<ResponseUtil<Object>> exception(HttpServletRequest request, Exception e) {

        logger.error("异常信息:{}", e);

        if (request != null && request instanceof ContentCachingRequestWrapper) {
            ContentCachingRequestWrapper wrapper = (ContentCachingRequestWrapper) request;
            logger.error("RequestURL:{}，QueryParam:{},RequestParam:{}", request.getRequestURI(),
                request.getQueryString(),
                new String(wrapper.getContentAsByteArray(), Charset.forName(wrapper.getCharacterEncoding())));
        }

        String msg = dealMessage(e.getMessage());
        HttpStatus httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
        return new ResponseEntity<>(ResponseUtil.fail(msg), httpStatus);
    }

    @ExceptionHandler(value = NoHandlerFoundException.class)
    public ResponseEntity<ResponseUtil<Object>> noHandlerFoundExceptionHandler(HttpServletRequest request,
        NoHandlerFoundException e) {
        if (request != null && request instanceof ContentCachingRequestWrapper) {
            ContentCachingRequestWrapper wrapper = (ContentCachingRequestWrapper) request;
            logger.error("[{}]RequestURL:{}，QueryParam:{},RequestParam:{}", NO_FOUND_ERROR_CODE,
                request.getRequestURI(), request.getQueryString(),
                new String(wrapper.getContentAsByteArray(), Charset.forName(wrapper.getCharacterEncoding())));
        }
        String msg = String.format("[%s]%s", NO_FOUND_ERROR_CODE, e.getMessage());
        logger.error(msg, e);
        HttpStatus httpStatus = HttpStatus.NOT_FOUND;
        return new ResponseEntity<>(ResponseUtil.fail(msg), httpStatus);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ResponseUtil<Object>> handleValidationExceptions(MethodArgumentNotValidException ex) {
        List<String> errors = ex.getBindingResult().getFieldErrors().stream()
            .map(DefaultMessageSourceResolvable::getDefaultMessage).collect(Collectors.toList());

        String msg = String.join(", ", errors);
        if (sysCode != null) {
            msg = msg + " [" + sysCode + "]";
        }
        return new ResponseEntity<>(ResponseUtil.fail(msg), HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ResponseUtil<Object>> handleConstraintViolation(ConstraintViolationException ex) {
        List<String> errors = ex.getConstraintViolations().stream()
            .map(violation -> violation.getPropertyPath() + ": " + violation.getMessage()).collect(Collectors.toList());

        String msg = String.join(", ", errors);
        if (sysCode != null) {
            msg = msg + " [" + sysCode + "]";
        }
        return new ResponseEntity<>(ResponseUtil.fail(msg), HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(BindException.class)
    public ResponseEntity<ResponseUtil<Object>> handleBindException(BindException ex) {
        List<String> errors = ex.getBindingResult().getFieldErrors().stream()
            .map(error -> error.getField() + ": " + error.getDefaultMessage()).collect(Collectors.toList());

        String msg = String.join(", ", errors);
        if (sysCode != null) {
            msg = msg + " [" + sysCode + "]";
        }
        return new ResponseEntity<>(ResponseUtil.fail(msg), HttpStatus.BAD_REQUEST);
    }

    private String dealMessage(String message) {
        if (StringUtils.isBlank(message)) {
            return message;
        }
        if (message.indexOf("MySQLSyntaxErrorException") > -1 || message.indexOf("SQLSyntaxErrorException") > -1
            || message.indexOf("PersistenceException") > -1 || message.indexOf("MysqlDataTruncation") > -1) {
            message = "SQL exception, please check the log.";
        }
        else if (message.indexOf("UNKNOW") > -1 && message.indexOf("Observable onError") > -1) {
            message = message + ", " + I18nUtil.get("ZmessageExceptionAop_observableOnError");
        }
        return message;
    }
}
