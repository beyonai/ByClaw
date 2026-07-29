package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.ResourceLock;
import org.junit.jupiter.api.parallel.Resources;

@ResourceLock(Resources.SYSTEM_PROPERTIES)
class SessionStreamManagerKeyTest {

    private static final String KEY_SCHEMA_VERSION = "REDIS_KEY_SCHEMA_VERSION";

    private final SessionStreamManager sessionStreamManager = new SessionStreamManager();

    private String originalKeySchemaVersion;

    @BeforeEach
    void saveKeySchemaVersion() {
        originalKeySchemaVersion = System.getProperty(KEY_SCHEMA_VERSION);
    }

    @AfterEach
    void restoreKeySchemaVersion() {
        if (originalKeySchemaVersion == null) {
            System.clearProperty(KEY_SCHEMA_VERSION);
        }
        else {
            System.setProperty(KEY_SCHEMA_VERSION, originalKeySchemaVersion);
        }
    }

    @Test
    void buildsV1SessionStreamKey() {
        System.setProperty(KEY_SCHEMA_VERSION, "v1");

        assertEquals("byai_gateway:session:session-10:data_stream",
            sessionStreamManager.buildStreamKey("session-10"));
    }

    @Test
    void buildsV2SessionStreamKeyWithSessionHashTag() {
        System.setProperty(KEY_SCHEMA_VERSION, "v2");

        assertEquals("byai_gateway:v2:session:{session-10}:data_stream",
            sessionStreamManager.buildStreamKey("session-10"));
    }
}
