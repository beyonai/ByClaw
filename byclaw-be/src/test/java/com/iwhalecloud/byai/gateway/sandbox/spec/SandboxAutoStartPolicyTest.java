package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.mapper.*;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SandboxAutoStartPolicyTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void missingLifecycleKeepsDefaultAndProviderOptionsRoundtrip() throws Exception {
        SandboxServiceSpec spec = json.readValue(
            "{\"runtimeOptions\":{\"microvm\":{\"templateId\":\"tpl-test\"}}}", SandboxServiceSpec.class);
        assertTrue(spec.isAutoStartEnabled());
        assertEquals("tpl-test", spec.getRuntimeOptions().get("microvm").get("templateId"));
        assertFalse(json.valueToTree(spec).has("autoStartEnabled"));
    }

    @Test
    void explicitFalseAndBooleanCoercionExcludeAutoStartWithoutLosingProviderOptions() throws Exception {
        for (String flag : new String[] {"\"false\"", "false"}) {
            SandboxServiceSpec spec = json.readValue(
                "{\"runtimeOptions\":{\"lifecycle\":{\"autoStart\":" + flag
                    + "},\"microvm\":{\"templateId\":\"tpl-test\"}}}", SandboxServiceSpec.class);
            assertFalse(spec.isAutoStartEnabled());
            SandboxServiceSpec copied = json.convertValue(spec, SandboxServiceSpec.class);
            assertFalse(copied.isAutoStartEnabled());
            assertEquals("tpl-test", copied.getRuntimeOptions().get("microvm").get("templateId"));
        }
    }

    @Test
    void onDemandEnabledSpecCanBeResolvedForExplicitLaunchWhileDisabledStillCannot() {
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        SandboxServiceSpecEntity row = new SandboxServiceSpecEntity();
        row.setServiceKey("byclaw-dsh-tools");
        row.setServiceType("byclaw-dsh-tools");
        row.setOwnerScope("USER");
        row.setEnabled(1);
        row.setSpecJson("{\"image\":\"fixture/tools:tag\",\"runtimeOptions\":{\"lifecycle\":{\"autoStart\":\"false\"}}}");
        when(mapper.selectProfileAwareByServiceKey("byclaw-dsh-tools")).thenReturn(row);
        MybatisSandboxServiceSpecRepository repository = new MybatisSandboxServiceSpecRepository(
            mapper, mock(SandboxServiceProfileEntityMapper.class), mock(SandboxProperties.class));
        SandboxServiceSpec enabled = repository.findByServiceKey("byclaw-dsh-tools").orElseThrow();
        assertFalse(enabled.isAutoStartEnabled());
        assertEquals("fixture/tools:tag", enabled.getImage());
        row.setEnabled(0);
        assertTrue(repository.findByServiceKey("byclaw-dsh-tools").isEmpty());
    }
}
