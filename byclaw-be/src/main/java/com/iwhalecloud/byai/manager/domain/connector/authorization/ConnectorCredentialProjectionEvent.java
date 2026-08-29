package com.iwhalecloud.byai.manager.domain.connector.authorization;

/** Requests reconciliation of one connector credential projection for one user. */
public record ConnectorCredentialProjectionEvent(Long userId, Long connectorId, Action action) {

    public enum Action {
        SYNC,
        DELETE
    }
}
