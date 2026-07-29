package com.iwhalecloud.byai.state.domain.recorder.model;

import java.util.Map;

public record RecorderError(String code, String message, String hint, Map<String, Object> details) {

    public RecorderError(String code, String message) {
        this(code, message, null, null);
    }
}
