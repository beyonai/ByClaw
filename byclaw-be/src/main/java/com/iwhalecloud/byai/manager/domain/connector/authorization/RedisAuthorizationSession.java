package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;

public record RedisAuthorizationSession(
    String authorizationId,
    String userId,
    Long connectorId,
    String connectorCode,
    String providerCode,
    AuthorizationStatus status,
    String phase,
    String authorizationUrlCipher,
    String providerSessionId,
    String providerStateCipher,
    String ownerInstanceId,
    @JsonFormat(shape = JsonFormat.Shape.NUMBER) Date expiresAt,
    String errorCode,
    String errorMessage,
    String manifestDigest,
    long version) {
    public RedisAuthorizationSession(
            String authorizationId,
            String userId,
            Long connectorId,
            String connectorCode,
            String providerCode,
            AuthorizationStatus status,
            String phase,
            String authorizationUrlCipher,
            String providerSessionId,
            String providerStateCipher,
            String ownerInstanceId,
            Date expiresAt,
            String errorCode,
            String errorMessage,
            long version) {
        this(
            authorizationId,
            userId,
            connectorId,
            connectorCode,
            providerCode,
            status,
            phase,
            authorizationUrlCipher,
            providerSessionId,
            providerStateCipher,
            ownerInstanceId,
            expiresAt,
            errorCode,
            errorMessage,
            null,
            version
        );
    }

    public RedisAuthorizationSession(
            String authorizationId,
            String userId,
            Long connectorId,
            String connectorCode,
            String providerCode,
            AuthorizationStatus status,
            String authorizationUrlCipher,
            String providerSessionId,
            String providerStateCipher,
            String ownerInstanceId,
            Date expiresAt,
            String errorCode,
            String errorMessage,
            long version) {
        this(
            authorizationId,
            userId,
            connectorId,
            connectorCode,
            providerCode,
            status,
            null,
            authorizationUrlCipher,
            providerSessionId,
            providerStateCipher,
            ownerInstanceId,
            expiresAt,
            errorCode,
            errorMessage,
            null,
            version
        );
    }
}
