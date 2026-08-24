package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;

import org.springframework.util.StringUtils;

/** OAuth2 state carrying a routable authorization id and a 256-bit CSRF secret. */
public final class OAuth2State {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int RANDOM_BYTES = 32;

    private OAuth2State() {
    }

    public static String create(String authorizationId) {
        String normalizedAuthorizationId = validateAuthorizationId(authorizationId);
        byte[] random = new byte[RANDOM_BYTES];
        SECURE_RANDOM.nextBytes(random);
        return normalizedAuthorizationId + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(random);
    }

    public static String authorizationId(String state) {
        if (!StringUtils.hasText(state)) {
            throw new IllegalArgumentException("OAuth2 state不能为空");
        }
        int separator = state.indexOf('.');
        if (separator <= 0 || separator != state.lastIndexOf('.') || separator == state.length() - 1) {
            throw new IllegalArgumentException("OAuth2 state格式无效");
        }
        String authorizationId = validateAuthorizationId(state.substring(0, separator));
        try {
            byte[] random = Base64.getUrlDecoder().decode(state.substring(separator + 1));
            if (random.length != RANDOM_BYTES) {
                throw new IllegalArgumentException("OAuth2 state随机值无效");
            }
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("OAuth2 state随机值无效", e);
        }
        return authorizationId;
    }

    private static String validateAuthorizationId(String authorizationId) {
        if (!StringUtils.hasText(authorizationId)) {
            throw new IllegalArgumentException("authorizationId不能为空");
        }
        try {
            return UUID.fromString(authorizationId).toString();
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("authorizationId格式无效", e);
        }
    }
}
