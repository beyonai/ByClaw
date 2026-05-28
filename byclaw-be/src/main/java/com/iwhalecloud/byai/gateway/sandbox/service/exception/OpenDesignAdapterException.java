package com.iwhalecloud.byai.gateway.sandbox.service.exception;

public class OpenDesignAdapterException extends RuntimeException {

    private final int statusCode;

    public OpenDesignAdapterException(int statusCode, String message) {
        super(message);
        this.statusCode = statusCode;
    }

    public OpenDesignAdapterException(int statusCode, String message, Throwable cause) {
        super(message, cause);
        this.statusCode = statusCode;
    }

    public int getStatusCode() {
        return statusCode;
    }
}
