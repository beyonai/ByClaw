package com.iwhalecloud.byai.state.application.service.recorder;

public class RecorderVerifyException extends RuntimeException {

    private final String code;
    private final String requestId;

    public RecorderVerifyException(String code, String message) {
        this(code, message, null);
    }

    public RecorderVerifyException(String code, String message, String requestId) {
        super(message);
        this.code = code;
        this.requestId = requestId;
    }

    public String getCode() {
        return code;
    }

    public String getRequestId() {
        return requestId;
    }

    RecorderVerifyException withRequestId(String canonicalRequestId) {
        return new RecorderVerifyException(code, getMessage(), canonicalRequestId);
    }
}
