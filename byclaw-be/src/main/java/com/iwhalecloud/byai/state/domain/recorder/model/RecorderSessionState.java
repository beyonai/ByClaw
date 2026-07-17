package com.iwhalecloud.byai.state.domain.recorder.model;

import com.fasterxml.jackson.annotation.JsonValue;

public enum RecorderSessionState {
    IDLE("idle"),
    HEALTH_CHECKED("health_checked"),
    SESSION_BOUND("session_bound"),
    AWAITING_USER_LOGIN("awaiting_user_login"),
    AUTH_CONFIRMED("auth_confirmed"),
    PAGE_READY("page_ready"),
    CAPTURE_A("capture_a"),
    CAPTURE_B("capture_b"),
    RANKED("ranked"),
    DRAFT_CREATED("draft_created"),
    VERIFYING("verifying"),
    DONE("done"),
    FAILED("failed"),
    CANCELLED("cancelled");

    private final String wireValue;

    RecorderSessionState(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    public boolean isTerminal() {
        return this == DONE || this == FAILED || this == CANCELLED;
    }
}
