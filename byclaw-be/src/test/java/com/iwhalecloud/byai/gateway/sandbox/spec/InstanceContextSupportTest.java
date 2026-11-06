package com.iwhalecloud.byai.gateway.sandbox.spec;
import com.alibaba.fastjson.JSON;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
class InstanceContextSupportTest {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {
        "false", "[]", "\"damaged\"", "null", "{}", "{\"viewer\":[]}",
        "{\"viewer\":\"novnc\",\"label\":{}}", "{\"viewer\":\"novnc\",\"extra\":[]}"
    })
    void damagedSnapshotDescriptorsDoNotBlockExistingLaunchDto(String descriptor) {
        String snapshot = "{\"version\":1,\"instanceBindings\":{},\"instanceDescriptors\":{\"desk\":"
            + descriptor + "}}";
        Map<String, Object> context = InstanceContextSupport.restore(snapshot, "host", null,
            Collections.singleton("desk"));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("sandboxId", "host");
        response.put("endpoint", "http://existing");
        response.put("instanceEndpoints", Collections.singletonMap("desk", "http://existing"));
        response.put("instanceContext", context);
        response.put("instanceDescriptors", InstanceContextSupport.descriptors(context));
        com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData decoded =
            org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> new com.fasterxml.jackson.databind.ObjectMapper()
                .convertValue(response, com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData.class));
        assertThat(decoded.getSandboxId()).isEqualTo("host");
        assertThat(decoded.getEndpoint()).isEqualTo("http://existing");
        assertThat(decoded.getInstanceEndpoints()).containsEntry("desk", "http://existing");
        assertThat(decoded.getInstanceContext()).isNull();
        assertThat(decoded.getInstanceDescriptors()).isNull();
    }

    @Test void snapshotRestoresOnlyAuthorizedInstancesWithoutCurrentTemplate() {
        SandboxServiceSpec spec = JSON.parseObject("{\"ports\":[{\"port\":8081,\"instance\":\"desk\",\"presentation\":{\"viewer\":\"novnc\",\"label\":\"Editor\"}},{\"port\":8082,\"instance\":\"private\"}],\"instanceBindings\":{\"editor.interaction\":[\"desk\",\"private\"]}}", SandboxServiceSpec.class);
        String persisted = JSON.toJSONString(InstanceContextSupport.snapshot(spec));
        spec.setPorts(Collections.emptyList());
        Map<String,Object> context = InstanceContextSupport.restore(persisted, "provider-host", "mapping", Collections.singleton("desk"));
        assertThat(context).containsEntry("sandboxId", "provider-host").containsEntry("mappingId", "mapping");
        assertThat(JSON.toJSONString(context)).doesNotContain("private");
        assertThat(InstanceContextSupport.descriptors(context).get("desk")).containsEntry("viewer", "novnc");
        assertThat(InstanceContextSupport.restore(null,"host",null,Collections.emptySet())).isNull();
    }
    @Test void damagedOptionalPresentationDoesNotRejectRequiredRuntimeSpec() {
        SandboxServiceSpec spec = JSON.parseObject("{\"image\":\"existing\",\"ports\":[{\"port\":8081,\"instance\":\"desk\",\"presentation\":false}],\"instanceBindings\":false}", SandboxServiceSpec.class);
        assertThat(spec.getImage()).isEqualTo("existing");
        assertThat(spec.getPorts().get(0).getPresentation()).isNull();
        assertThat(spec.getInstanceBindings()).isNull();
        assertThat(ToolSandboxMetadata.validationError("{\"ports\":[{\"port\":8081,\"instance\":\"desk\"}],\"instanceBindings\":{\"default\":[\"missing\"]}}")).isEqualTo("Unknown bound instance");
    }
    @Test void databaseSpecReaderKeepsExecutionForDamagedOptionalFields() {
        com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper mapper = org.mockito.Mockito.mock(com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper.class);
        com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceProfileEntityMapper profiles = org.mockito.Mockito.mock(com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceProfileEntityMapper.class);
        com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity row = new com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity();
        row.setServiceKey("tool");
        row.setEnabled(1);
        row.setSpecJson("{\"image\":\"original-image\",\"ports\":[{\"port\":8081,\"instance\":\"desk\",\"presentation\":\"bad\"}],\"instanceBindings\":{\"default\":\"bad\"}}");
        org.mockito.Mockito.when(mapper.selectProfileAwareByServiceKey("tool")).thenReturn(row);
        MybatisSandboxServiceSpecRepository repository = new MybatisSandboxServiceSpecRepository(mapper, profiles, new com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties());
        SandboxServiceSpec runtime = repository.findByServiceKey("tool").orElseThrow();
        assertThat(runtime.getImage()).isEqualTo("original-image");
        assertThat(runtime.getPorts().get(0).getPort()).isEqualTo(8081);
        assertThat(runtime.getPorts().get(0).getPresentation()).isNull();
        assertThat(runtime.getInstanceBindings()).isNull();
        assertThat(ToolSandboxMetadata.validationError(row.getSpecJson())).isEqualTo("Invalid instance presentation");
    }

}
