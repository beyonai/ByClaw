package com.iwhalecloud.byai.gateway.sandbox.spec;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.workspace.SandboxWorkspaceBootstrapInitializer;

class GenericSandboxSpecProcessorTest {

    @Test
    void buildCreateRequest_keepsOnlySpecDefinedEnvKeys() {
        SandboxWorkspaceBootstrapInitializer bootstrapInitializer = mock(SandboxWorkspaceBootstrapInitializer.class);
        GenericSandboxSpecProcessor processor = new GenericSandboxSpecProcessor(bootstrapInitializer);

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setImage("demo/image:latest");
        Map<String, String> specEnv = new LinkedHashMap<>();
        specEnv.put("ONLY_DEFINED", "literal");
        specEnv.put("FROM_REQUEST", "prefix-${envVars.EXTERNAL_VALUE}");
        specEnv.put("FROM_USER", "${userInfo.nickname}");
        spec.setEnv(specEnv);

        Map<String, String> requestEnv = Map.of(
            "EXTERNAL_VALUE", "rendered",
            "UNDEFINED_KEY", "should-not-pass"
        );
        Map<String, Object> userInfo = Map.of("nickname", "alice");

        CreateSandboxRequest request = processor.buildCreateRequest(
            "user001", "openclaw", requestEnv, userInfo, spec);

        assertThat(request.getEnv()).containsOnlyKeys("ONLY_DEFINED", "FROM_REQUEST", "FROM_USER");
        assertThat(request.getEnv()).doesNotContainKeys("EXTERNAL_VALUE", "UNDEFINED_KEY");
        assertThat(request.getEnv().get("ONLY_DEFINED")).isEqualTo("literal");
        assertThat(request.getEnv().get("FROM_REQUEST")).isEqualTo("prefix-rendered");
        assertThat(request.getEnv().get("FROM_USER")).isEqualTo("alice");
        verifyNoInteractions(bootstrapInitializer);
    }

    @Test
    void buildCreateRequest_returnsNullEnvWhenSpecHasNoEnv() {
        SandboxWorkspaceBootstrapInitializer bootstrapInitializer = mock(SandboxWorkspaceBootstrapInitializer.class);
        GenericSandboxSpecProcessor processor = new GenericSandboxSpecProcessor(bootstrapInitializer);

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setImage("demo/image:latest");

        CreateSandboxRequest request = processor.buildCreateRequest(
            "user001", "openclaw", Map.of("EXTERNAL_VALUE", "rendered"), Map.of(), spec);

        assertThat(request.getEnv()).isNull();
        verifyNoInteractions(bootstrapInitializer);
    }
}
