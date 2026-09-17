package com.iwhalecloud.byai.state.common.redis;

import java.util.Map;
import java.util.function.BiFunction;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.session.MapSession;
import org.springframework.session.data.redis.RedisSessionMapper;

/**
 * Treats incomplete Redis session hashes as expired sessions.
 *
 * @author qin.guoquan
 * @date 2026-09-08 17:12:38
 */
final class SafeRedisSessionMapper implements BiFunction<String, Map<String, Object>, MapSession> {

    private static final Logger LOGGER = LoggerFactory.getLogger(SafeRedisSessionMapper.class);

    private final RedisSessionMapper delegate = new RedisSessionMapper();

    @Override
    public MapSession apply(String sessionId, Map<String, Object> sessionData) {
        try {
            return delegate.apply(sessionId, sessionData);
        }
        catch (IllegalStateException exception) {
            LOGGER.warn("Discarding malformed Redis session: {}", exception.getMessage());
            return null;
        }
    }
}
