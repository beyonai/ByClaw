package com.iwhalecloud.byai.state.domain.recorder.model;

public record RecorderEnvelope<T>(
    boolean ok,
    String schemaVersion,
    String requestId,
    T data,
    RecorderError error
) {

    private static final String SCHEMA_VERSION = "recorder.v1";

    public static <T> RecorderEnvelope<T> ok(String requestId, T data) {
        return new RecorderEnvelope<>(true, SCHEMA_VERSION, requestId, data, null);
    }

    public static RecorderEnvelope<Void> fail(String requestId, String code, String message) {
        return new RecorderEnvelope<>(false, SCHEMA_VERSION, requestId, null, new RecorderError(code, message));
    }
}
