package com.iwhalecloud.byai.manager.domain.connector.authorization;

public interface ConnectorAuthorizationProvider {

    String providerCode();

    AuthorizationStartResult start(AuthorizationStartContext context);

    AuthorizationStatusResult queryStatus(AuthorizationSessionContext session);

    default AuthorizationStatusResult handleCallback(
            AuthorizationSessionContext session,
            AuthorizationCallback callback) {
        throw new UnsupportedOperationException("callback is not supported");
    }

    default void cancel(AuthorizationSessionContext session) {
    }
}
