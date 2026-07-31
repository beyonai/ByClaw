package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.lang.reflect.Field;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;

class SandboxWakeupStreamListenerTest {

    @Test
    void streamKey_remainsConfigurableForLegacyDeployments() throws NoSuchFieldException {
        Field streamKeyField = SandboxWakeupStreamListener.class.getDeclaredField("streamKey");

        Value value = streamKeyField.getAnnotation(Value.class);

        assertNotNull(value);
        assertEquals(
            "${byclaw.sandbox.wakeup-stream.key:byai_gateway:control_plane:mgmt:wakeup}",
            value.value()
        );
    }
}
