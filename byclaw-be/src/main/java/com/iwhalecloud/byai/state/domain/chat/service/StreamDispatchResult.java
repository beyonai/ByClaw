package com.iwhalecloud.byai.state.domain.chat.service;

public enum StreamDispatchResult {
    HANDLED(true),
    INTENTIONALLY_IGNORED(true),
    MISSING_CONTEXT(false),
    ERROR(false);

    private final boolean acknowledge;

    StreamDispatchResult(boolean acknowledge) {
        this.acknowledge = acknowledge;
    }

    public boolean shouldAcknowledge() {
        return acknowledge;
    }
}
