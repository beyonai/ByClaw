package com.iwhalecloud.byai.manager.domain.connector.authorization;

public interface ConnectorAuthorizationProvider {

    String providerCode();

    AuthorizationStartResult start(AuthorizationStartContext context);

    AuthorizationStatusResult queryStatus(AuthorizationSessionContext session);

    default void cancel(AuthorizationSessionContext session) {
    }
}
