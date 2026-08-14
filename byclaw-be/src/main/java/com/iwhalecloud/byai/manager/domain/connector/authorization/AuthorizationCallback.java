package com.iwhalecloud.byai.manager.domain.connector.authorization;

/** Platform callback parameters after an OAuth2 authorization redirect. */
public record AuthorizationCallback(
    String code,
    String state,
    String error,
    String errorDescription
) {
}
