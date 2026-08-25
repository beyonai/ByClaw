package com.iwhalecloud.byai.gateway.sandbox.spec;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.Volume;
import com.iwhalecloud.byai.gateway.sandbox.workspace.SandboxWorkspaceBootstrapInitializer;
import com.iwhalecloud.byai.gateway.sandbox.workspace.model.SandboxFsInitContext;
@DisabledOnOs(OS.WINDOWS)
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

    @Test
    void buildCreateRequest_passesVolumeOwnershipAndMode() {
        SandboxWorkspaceBootstrapInitializer bootstrapInitializer = mock(SandboxWorkspaceBootstrapInitializer.class);
        GenericSandboxSpecProcessor processor = new GenericSandboxSpecProcessor(bootstrapInitializer);

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setImage("demo/image:latest");

        VolumeSpec volume = new VolumeSpec();
        volume.setKey("home");
        volume.setScope(VolumeScope.PRIVATE);
        volume.setHostPath("/data/byclaw");
        volume.setSubPath("byclaw-${user_code}/home");
        volume.setMountPath("/home");
        volume.setReadOnly(false);
        volume.setUid(1001);
        volume.setGid(1001);
        volume.setMode("0770");
        spec.setVolumes(List.of(volume));

        CreateSandboxRequest request = processor.buildCreateRequest(
            "user001", "code-agent", Map.of(), Map.of(), spec);

        assertThat(request.getVolumes()).singleElement().satisfies(item -> {
            assertThat(item).isInstanceOf(Volume.class);
            assertThat(item.getUid()).isEqualTo(1001);
            assertThat(item.getGid()).isEqualTo(1001);
            assertThat(item.getMode()).isEqualTo("0770");
        });
    }

    @Test
    void buildCreateRequest_bootstrapUsesVolumeHostPathAndSubPathAsWorkspaceTarget() {
        SandboxWorkspaceBootstrapInitializer bootstrapInitializer = mock(SandboxWorkspaceBootstrapInitializer.class);
        GenericSandboxSpecProcessor processor = new GenericSandboxSpecProcessor(bootstrapInitializer);

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setImage("demo/image:latest");

        VolumeSpec volume = new VolumeSpec();
        volume.setKey("base");
        volume.setScope(VolumeScope.PRIVATE);
        volume.setHostPath("${FILE_STORAGE_LOCAL_PATH}");
        volume.setSubPath("byclaw-${user_code}/by");
        volume.setMountPath("/by");
        volume.setReadOnly(false);
        spec.setVolumes(List.of(volume));

        CopyTemplateOp copyTemplate = new CopyTemplateOp();
        copyTemplate.setTargetVolumeKey("base");
        BootstrapSpec bootstrap = new BootstrapSpec();
        bootstrap.setCopyTemplate(copyTemplate);
        spec.setBootstrap(bootstrap);
        spec.setTemplateJson("{\"profile\":\"test\"}");

        processor.buildCreateRequest("user001", "openclaw",
            Map.of("FILE_STORAGE_LOCAL_PATH", "/mnt/byclaw-workspace"), Map.of(), spec);

        ArgumentCaptor<SandboxFsInitContext> captor = ArgumentCaptor.forClass(SandboxFsInitContext.class);
        verify(bootstrapInitializer).initialize(captor.capture());
        assertThat(captor.getValue().getWorkspaceTargetPath())
            .isEqualTo("/mnt/byclaw-workspace/byclaw-user001/by");
        assertThat(captor.getValue().getTemplateSourcePath().toString())
            .isEqualTo("/mnt/byclaw-workspace/byclaw-user001/by");
    }
}
