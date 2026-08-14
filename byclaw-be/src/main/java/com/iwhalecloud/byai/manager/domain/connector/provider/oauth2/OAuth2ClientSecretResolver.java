package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

@FunctionalInterface
public interface OAuth2ClientSecretResolver {
    String resolve(String environmentName);
}
