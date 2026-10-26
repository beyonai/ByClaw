package com.iwhalecloud.byai.common.integration.security;
import java.time.Duration;
/** Atomic shared replay reservation; failures must propagate and fail authentication closed. */
@FunctionalInterface
public interface InternalServiceNonceStore { boolean reserve(String key, Duration ttl); }
