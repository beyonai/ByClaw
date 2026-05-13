package com.iwhalecloud.byai.common.log.exception;


import lombok.Getter;
import lombok.Setter;

/**
 * 异常基类
 */
@Getter
@Setter
public class BaseRuntimeException extends RuntimeException {
    protected String errorService;
    protected Throwable errorThrowable;
    protected String errorMsg;

    /**
     * 直接抛出异常的
     *
     * @param errorMessage
     */
    public BaseRuntimeException(String errorMessage) {
        super(errorMessage);
        this.errorMsg = errorMessage;
    }

    /**
     * 这个式在GlobalExceptionHandler被捕获的错误
     *
     * @param errorService
     * @param cause
     */
    public BaseRuntimeException(String errorService, Throwable cause) {
        super(cause);
        this.errorService = errorService;
        this.errorThrowable = cause;
        this.errorMsg = cause.getMessage();
    }


    @Override
    public String toString() {
        return errorMsg;
    }
}
