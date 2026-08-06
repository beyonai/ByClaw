package com.iwhalecloud.byai.manager.domain.connector.service;

/** Stable, sanitized failure raised by the Skill authorization synchronization boundary. */
public class ConnectorSkillAuthorizationSyncException extends RuntimeException {

    private final String errorCode;
    private final boolean retryable;

    public ConnectorSkillAuthorizationSyncException(
            String errorCode,
            String message,
            boolean retryable) {
        super(message);
        this.errorCode = errorCode;
        this.retryable = retryable;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public boolean isRetryable() {
        return retryable;
    }
}
