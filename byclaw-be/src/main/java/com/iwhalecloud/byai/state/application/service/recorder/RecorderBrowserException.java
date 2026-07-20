package com.iwhalecloud.byai.state.application.service.recorder;

public class RecorderBrowserException extends RuntimeException {

    private final String code;
    private final int httpStatus;

    public RecorderBrowserException(String code, String message) {
        this(code, message, defaultHttpStatus(code));
    }

    public RecorderBrowserException(String code, String message, int httpStatus) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
    }

    public String getCode() {
        return code;
    }

    public int getHttpStatus() {
        return httpStatus;
    }

    private static int defaultHttpStatus(String code) {
        return switch (code) {
            case "page_lost" -> 409;
            case "navigation_url_forbidden" -> 400;
            case "daemon_unavailable", "extension_disconnected" -> 503;
            default -> 502;
        };
    }
}
