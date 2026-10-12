package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

public class DeepSeekWebSearchException extends RuntimeException {
    private final String errorCode;

    public DeepSeekWebSearchException(String errorCode, String message) {
        super(errorCode + ": " + message);
        this.errorCode = errorCode;
    }

    public DeepSeekWebSearchException(String errorCode, String message, Throwable cause) {
        super(errorCode + ": " + message, cause);
        this.errorCode = errorCode;
    }

    public String getErrorCode() {
        return errorCode;
    }
}
