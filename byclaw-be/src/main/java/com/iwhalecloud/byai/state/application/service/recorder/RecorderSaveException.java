package com.iwhalecloud.byai.state.application.service.recorder;

import java.util.Map;

public class RecorderSaveException extends RuntimeException {

    private final String code;
    private final Map<String, Object> details;

    public RecorderSaveException(String code, String message) {
        this(code, message, null, null);
    }

    public RecorderSaveException(String code, String message, Throwable cause) {
        this(code, message, cause, null);
    }

    public RecorderSaveException(String code, String message, Map<String, Object> details) {
        this(code, message, null, details);
    }

    private RecorderSaveException(String code, String message, Throwable cause, Map<String, Object> details) {
        super(message, cause);
        this.code = code;
        this.details = details == null ? null : Map.copyOf(details);
    }

    public String getCode() {
        return code;
    }

    public Map<String, Object> getDetails() {
        return details;
    }
}
