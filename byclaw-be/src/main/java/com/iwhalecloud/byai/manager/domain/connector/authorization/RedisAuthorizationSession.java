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
    String authorizationUrlCipher,
    String providerSessionId,
    String providerStateCipher,
    String ownerInstanceId,
    @JsonFormat(shape = JsonFormat.Shape.NUMBER) Date expiresAt,
    String errorCode,
    String errorMessage,
    long version) {
}
