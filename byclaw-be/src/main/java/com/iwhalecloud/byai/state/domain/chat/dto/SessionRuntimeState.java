package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

/** Authoritative runtime state projected by any external session runtime integration. */
@Getter
@Setter
public class SessionRuntimeState {

    public static final String STATUS_RUNNING = "running";

    public static final String STATUS_WAITING_USER = "waiting_user";

    private Long sessionId;

    private String traceId;

    private String source;

    private String status;

    private Boolean rootActive;

    private Boolean acceptingInput;

    private Long activeAgentCount;

    private Long activeChildCount;

    private Long waitingInteractionCount;

    private Long revision;

    private Long changedAt;

    public boolean isActive() {
        return STATUS_RUNNING.equals(status) || STATUS_WAITING_USER.equals(status)
            || positive(activeAgentCount) || positive(waitingInteractionCount);
    }

    private boolean positive(Long value) {
        return value != null && value > 0;
    }
}
