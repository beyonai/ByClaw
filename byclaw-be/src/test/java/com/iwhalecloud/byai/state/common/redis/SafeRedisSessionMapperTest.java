package com.iwhalecloud.byai.state.common.redis;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.session.MapSession;

import static org.assertj.core.api.Assertions.assertThat;

class SafeRedisSessionMapperTest {

    private final SafeRedisSessionMapper mapper = new SafeRedisSessionMapper();

    @Test
    void applyMapsCompleteSession() {
        Map<String, Object> sessionData = new HashMap<>();
        sessionData.put("creationTime", 1_000L);
        sessionData.put("lastAccessedTime", 2_000L);
        sessionData.put("maxInactiveInterval", 1_800);
        sessionData.put("sessionAttr:userCode", "adminvip");

        MapSession session = mapper.apply("session-id", sessionData);

        assertThat(session).isNotNull();
        assertThat(session.getCreationTime()).isEqualTo(Instant.ofEpochMilli(1_000L));
        assertThat(session.getLastAccessedTime()).isEqualTo(Instant.ofEpochMilli(2_000L));
        assertThat(session.getMaxInactiveInterval().getSeconds()).isEqualTo(1_800L);
        assertThat(session.<String>getAttribute("userCode")).isEqualTo("adminvip");
    }

    @Test
    void applyReturnsNullWhenRequiredMetadataIsMissing() {
        Map<String, Object> sessionData = new HashMap<>();
        sessionData.put("lastAccessedTime", 2_000L);
        sessionData.put("maxInactiveInterval", 1_800);

        assertThat(mapper.apply("session-id", sessionData)).isNull();
    }
}
