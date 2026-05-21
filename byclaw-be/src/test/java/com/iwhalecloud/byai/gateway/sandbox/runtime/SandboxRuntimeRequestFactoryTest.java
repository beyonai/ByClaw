package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.feign.request.sandbox.WhaleAgentListSandboxesRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.HostVolume;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ImageSpec;
import com.iwhalecloud.byai.gateway.sandbox.client.model.Volume;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

class SandboxRuntimeRequestFactoryTest {

    @Test
    void applyRuntimeMetadata_mergesExistingMetadataAndGatewayToken() {
        CreateSandboxRequest request = CreateSandboxRequest.builder()
            .env(Map.of("OPENCLAW_GATEWAY_TOKEN", "token-1"))
            .metadata(Map.of("userCode", "u1"))
            .build();

        SandboxRuntimeRequestFactory.applyRuntimeMetadata(request, "idem-1");

        assertThat(request.getMetadata())
            .containsEntry("userCode", "u1")
            .containsEntry("idempotencyKey", "idem-1")
            .containsEntry("gateway_token", "token-1");
    }

    @Test
    void buildCommonLaunchPayload_mapsSharedCreateRequestFields() {
        CreateSandboxRequest request = CreateSandboxRequest.builder()
            .timeout(3600)
            .metadata(Map.of("userCode", "u1", "serviceKey", "openclaw"))
            .entrypoint(List.of("node", "dist/index.js"))
            .env(Map.of("A", "B"))
            .image(ImageSpec.builder().uri("ghcr.io/test/image:main").build())
            .resourceLimits(Map.of("cpu", "2"))
            .volumes(List.of(Volume.builder()
                .name("data")
                .host(new HostVolume("/host/path"))
                .mountPath("/workspace")
                .readOnly(false)
                .subPath("u1")
                .scope("user")
                .build()))
            .build();
        SandboxServiceSpec spec = new SandboxServiceSpec();
        PortSpec port = new PortSpec();
        port.setPort(8080);
        spec.setPorts(List.of(port));

        Map<String, Object> commonPayload = SandboxRuntimeRequestFactory.buildCommonLaunchPayload(request);

        assertThat(commonPayload.get("entrypoint")).isEqualTo(List.of("node", "dist/index.js"));
        assertThat(commonPayload.get("env")).isEqualTo(Map.of("A", "B"));
        assertThat(commonPayload.get("timeout")).isEqualTo(3600);
        assertThat(commonPayload.get("metadata")).isEqualTo(Map.of("userCode", "u1", "serviceKey", "openclaw"));
        assertThat(commonPayload.get("resourceLimits")).isEqualTo(Map.of("cpu", "2"));

        @SuppressWarnings("unchecked")
        Map<String, Object> commonImage = (Map<String, Object>) commonPayload.get("image");
        assertThat(commonImage).containsEntry("uri", "ghcr.io/test/image:main");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commonVolumes = (List<Map<String, Object>>) commonPayload.get("volumes");
        assertThat(commonVolumes).singleElement().satisfies(item -> assertThat(item)
            .containsEntry("name", "data")
            .containsEntry("mountPath", "/workspace")
            .containsEntry("readOnly", false)
            .containsEntry("subPath", "u1")
            .containsEntry("scope", "user"));
    }

    @Test
    void buildWhaleAgentLaunchPayload_onlyAddsWhaleAgentSpecificFields() {
        CreateSandboxRequest request = CreateSandboxRequest.builder()
            .entrypoint(List.of("node", "dist/index.js"))
            .env(Map.of("A", "B"))
            .image(ImageSpec.builder().uri("ghcr.io/test/image:main").build())
            .resourceLimits(Map.of("cpu", "2"))
            .volumes(List.of(Volume.builder()
                .name("data")
                .host(new HostVolume("/host/path"))
                .mountPath("/workspace")
                .readOnly(false)
                .subPath("u1")
                .scope("user")
                .build()))
            .build();
        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServicePort(18789);
        PortSpec port = new PortSpec();
        port.setPort(8080);
        spec.setPorts(List.of(port));

        Map<String, Object> payload = SandboxRuntimeRequestFactory.buildWhaleAgentLaunchPayload(request, spec, "byclaw");

        assertThat(payload.get("entrypoint")).isEqualTo(List.of("node", "dist/index.js"));
        assertThat(payload.get("env")).isEqualTo(Map.of("A", "B"));
        assertThat(payload.get("resourceLimits")).isEqualTo(Map.of("cpu", "2"));
        assertThat(payload.get("servicePort")).isEqualTo(18789);
        assertThat(payload.get("sandboxType")).isEqualTo("byclaw");

        @SuppressWarnings("unchecked")
        Map<String, Object> image = (Map<String, Object>) payload.get("image");
        assertThat(image).containsEntry("uri", "ghcr.io/test/image:main");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> volumes = (List<Map<String, Object>>) payload.get("volumes");
        assertThat(volumes).singleElement().satisfies(item -> assertThat(item)
            .containsEntry("name", "data")
            .containsEntry("mountPath", "/workspace")
            .containsEntry("readOnly", false)
            .containsEntry("subPath", "u1")
            .containsEntry("scope", "user"));
    }

    @Test
    void buildWhaleAgentListSandboxesRequest_usesMetadataFilter() {
        WhaleAgentListSandboxesRequest request = SandboxRuntimeRequestFactory.buildWhaleAgentListSandboxesRequest(
            "u1", "openclaw");

        assertThat(request.getPage()).isEqualTo(1);
        assertThat(request.getPageSize()).isEqualTo(100);
        assertThat(request.getMetadata()).isEqualTo(Map.of("userCode", "u1", "serviceKey", "openclaw"));
    }

    @Test
    void resolveGatewayToken_prefersRuntimeMetadataOverCurrentEnv() {
        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder()
            .metadata(Map.of("gateway_token", "persisted-token"))
            .build();
        CreateSandboxRequest request = CreateSandboxRequest.builder()
            .env(Map.of("OPENCLAW_GATEWAY_TOKEN", "fresh-token"))
            .build();

        String gatewayToken = SandboxRuntimeRequestFactory.resolveGatewayToken(instance, request);

        assertThat(gatewayToken).isEqualTo("persisted-token");
    }
}
