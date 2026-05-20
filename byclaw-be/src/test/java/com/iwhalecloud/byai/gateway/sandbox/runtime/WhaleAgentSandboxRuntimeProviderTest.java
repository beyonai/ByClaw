package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.common.feign.client.FeignWhaleAgentService;
import com.iwhalecloud.byai.common.feign.request.sandbox.WhaleAgentListSandboxesRequest;
import com.iwhalecloud.byai.common.feign.request.sandbox.RenewSandboxTimeoutRequest;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxCreateResult;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxRenewResult;
import com.iwhalecloud.byai.common.feign.response.sandbox.WhaleAgentSandboxPageResult;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.HostVolume;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ImageSpec;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxStatus;
import com.iwhalecloud.byai.gateway.sandbox.client.model.Volume;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

class WhaleAgentSandboxRuntimeProviderTest {

    @Test
    void create_usesFeignAndMapsLaunchPayload() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        WhaleAgentSandboxRuntimeProvider provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);

        SandboxCreateResult result = new SandboxCreateResult();
        result.setEndpoint("http://10.10.186.14:43931/proxy/18789");
        result.setSandboxId("db69df24-de95-4b3f-aff3-0d0a4149e30f");
        KnowledgeResponse<SandboxCreateResult> response = KnowledgeResponse.success(result);
        when(feignWhaleAgentService.launchSandbox(anyMap())).thenReturn(response);

        CreateSandboxRequest request = CreateSandboxRequest.builder()
            .entrypoint(List.of("node", "dist/index.js", "gateway"))
            .env(Map.of("OPENCLAW_GATEWAY_TOKEN", "ztesoft"))
            .metadata(Map.of("userCode", "user001", "serviceKey", "byclaw-code-agent"))
            .image(ImageSpec.builder().uri("10.10.236.107:8099/sandbox/openclaw:2026.3.2").build())
            .resourceLimits(Map.of("cpu", "2", "memory", "2Gi"))
            .volumes(List.of(Volume.builder()
                .name("openclaw-data")
                .host(new HostVolume("/host/path"))
                .mountPath("/home/node/.openclaw")
                .readOnly(false)
                .subPath("admin/openclaw")
                .build()))
            .build();

        SandboxServiceSpec spec = new SandboxServiceSpec();
        PortSpec portSpec = new PortSpec();
        portSpec.setPort(18789);
        spec.setPorts(List.of(portSpec));

        SandboxRuntimeInstance instance = provider.create(request, spec, "user001", "byclaw-code-agent", "idem-1");

        assertThat(instance.getSandboxId()).isEqualTo("db69df24-de95-4b3f-aff3-0d0a4149e30f");
        assertThat(instance.getEndpoints()).containsExactly("http://10.10.186.14:43931/proxy/18789");

        ArgumentCaptor<Map<String, Object>> payloadCaptor = ArgumentCaptor.forClass(Map.class);
        verify(feignWhaleAgentService).launchSandbox(payloadCaptor.capture());
        Map<String, Object> payload = payloadCaptor.getValue();
        assertThat(payload.get("entrypoint")).isEqualTo(List.of("node", "dist/index.js", "gateway"));
        assertThat(payload.get("env")).isEqualTo(Map.of("OPENCLAW_GATEWAY_TOKEN", "ztesoft"));
        assertThat(payload.get("resourceLimits")).isEqualTo(Map.of("cpu", "2", "memory", "2Gi"));
        assertThat(payload.get("servicePort")).isEqualTo(18789);
        assertThat(payload.get("sandboxType")).isEqualTo("byclaw");
        assertThat(payload.get("metadata")).isEqualTo(Map.of(
            "userCode", "user001",
            "serviceKey", "byclaw-code-agent",
            "idempotencyKey", "idem-1",
            "gateway_token", "ztesoft"));

        @SuppressWarnings("unchecked")
        Map<String, Object> image = (Map<String, Object>) payload.get("image");
        assertThat(image).containsEntry("uri", "10.10.236.107:8099/sandbox/openclaw:2026.3.2");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> volumes = (List<Map<String, Object>>) payload.get("volumes");
        assertThat(volumes).hasSize(1);
        assertThat(volumes.get(0))
            .containsEntry("mountPath", "/home/node/.openclaw")
            .containsEntry("name", "openclaw-data")
            .containsEntry("readOnly", false)
            .containsEntry("subPath", "admin/openclaw");
    }

    @Test
    void remove_callsFeignWithSandboxIdOnly() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        WhaleAgentSandboxRuntimeProvider provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);

        SandboxInfo sandboxInfo = SandboxInfo.builder().sandboxId("480d4020-70ba-4e0e-bfe2-9254b91bf5b9").build();

        provider.remove("user001", "byclaw-code-agent", sandboxInfo);

        verify(feignWhaleAgentService).destroySandbox(Map.of("sandboxId", "480d4020-70ba-4e0e-bfe2-9254b91bf5b9"));
    }

    @Test
    void remove_skipsWhenSandboxIdMissing() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        WhaleAgentSandboxRuntimeProvider provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);

        provider.remove("user001", "byclaw-code-agent", SandboxInfo.builder().build());

        verify(feignWhaleAgentService, never()).destroySandbox(anyMap());
    }

    @Test
    void heartbeat_callsRenewWithSandboxIdAndDuration() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        WhaleAgentSandboxRuntimeProvider provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);
        SandboxRenewResult renewResult = new SandboxRenewResult();
        renewResult.setExpiresAt("2026-05-20T08:20:25.357000Z");
        when(feignWhaleAgentService.renewSandboxTimeout(any())).thenReturn(KnowledgeResponse.success(renewResult));

        SandboxInfo sandboxInfo = SandboxInfo.builder()
            .sandboxId("846c09b3-efe2-47ff-bd31-d9a26f6a2f2f")
            .timeoutSeconds(300)
            .build();

        provider.heartbeat("user001", "byclaw-code-agent", sandboxInfo);

        ArgumentCaptor<RenewSandboxTimeoutRequest> requestCaptor = ArgumentCaptor.forClass(RenewSandboxTimeoutRequest.class);
        verify(feignWhaleAgentService).renewSandboxTimeout(requestCaptor.capture());
        assertThat(requestCaptor.getValue().getSandboxId()).isEqualTo("846c09b3-efe2-47ff-bd31-d9a26f6a2f2f");
        assertThat(requestCaptor.getValue().getDuration()).isEqualTo(300);
        assertThat(sandboxInfo.getRemoteExpiresAt()).isEqualTo(
            java.util.Date.from(OffsetDateTime.parse("2026-05-20T08:20:25.357000Z").toInstant()));
    }

    @Test
    void heartbeat_skipsWhenSandboxIdOrTimeoutMissing() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        WhaleAgentSandboxRuntimeProvider provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);

        provider.heartbeat("user001", "byclaw-code-agent", SandboxInfo.builder().timeoutSeconds(300).build());
        provider.heartbeat("user001", "byclaw-code-agent", SandboxInfo.builder().sandboxId("sandbox-1").build());
        provider.heartbeat("user001", "byclaw-code-agent", SandboxInfo.builder().sandboxId("sandbox-1").timeoutSeconds(0).build());

        verify(feignWhaleAgentService, never()).renewSandboxTimeout(any());
    }

    @Test
    void findReusable_usesMetadataFilterAndReturnsNewestRunningSandbox() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        WhaleAgentSandboxRuntimeProvider provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);

        SandboxDetail older = new SandboxDetail();
        older.setId("sandbox-older");
        older.setCreatedAt(java.time.OffsetDateTime.parse("2026-05-15T10:00:00Z"));
        older.setExpiresAt(java.time.OffsetDateTime.parse("2026-05-15T11:00:00Z"));
        older.setStatus(new SandboxStatus("Running", "CONTAINER_RUNNING", "running", null));

        SandboxDetail newer = new SandboxDetail();
        newer.setId("sandbox-newer");
        newer.setCreatedAt(java.time.OffsetDateTime.parse("2026-05-15T10:05:00Z"));
        newer.setExpiresAt(java.time.OffsetDateTime.parse("2026-05-15T11:05:00Z"));
        newer.setStatus(new SandboxStatus("Running", "CONTAINER_RUNNING", "running", null));

        WhaleAgentSandboxPageResult result = new WhaleAgentSandboxPageResult();
        result.setItems(List.of(older, newer));
        when(feignWhaleAgentService.listSandboxes(any()))
            .thenReturn(KnowledgeResponse.success(result));

        newer.setMetadata(Map.of("gateway_token", "persisted-token"));

        Optional<SandboxRuntimeInstance> reusable = provider.findReusable("user001", "byclaw-code-agent");

        assertThat(reusable).isPresent();
        assertThat(reusable.get().getSandboxId()).isEqualTo("sandbox-newer");
        assertThat(reusable.get().getMetadata()).containsEntry("gateway_token", "persisted-token");
        verify(feignWhaleAgentService).listSandboxes(
            new WhaleAgentListSandboxesRequest(1, 100, Map.of("userCode", "user001", "serviceKey", "byclaw-code-agent")));
    }

    @Test
    void exists_returnsTrueWhenSandboxIsRunning() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        WhaleAgentSandboxRuntimeProvider provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);
        SandboxDetail detail = new SandboxDetail();
        detail.setId("sandbox-1");
        detail.setStatus(new SandboxStatus("Running", "CONTAINER_RUNNING", "running", null));
        when(feignWhaleAgentService.getSandboxInfo(anyMap())).thenReturn(KnowledgeResponse.success(detail));

        boolean exists = provider.exists("user001", "byclaw-code-agent", SandboxInfo.builder().sandboxId("sandbox-1").build());

        assertThat(exists).isTrue();
        verify(feignWhaleAgentService).getSandboxInfo(Map.of("sandboxId", "sandbox-1"));
    }

    @Test
    void exists_returnsFalseWhenSandboxDetailMissingOrExited() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        WhaleAgentSandboxRuntimeProvider provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);

        SandboxDetail exited = new SandboxDetail();
        exited.setId("sandbox-1");
        exited.setStatus(new SandboxStatus("Exited", "CONTAINER_EXITED", "exited", null));
        when(feignWhaleAgentService.getSandboxInfo(anyMap()))
            .thenReturn(KnowledgeResponse.success(null))
            .thenReturn(KnowledgeResponse.success(exited));

        assertThat(provider.exists("user001", "byclaw-code-agent", SandboxInfo.builder().sandboxId("sandbox-1").build()))
            .isFalse();
        assertThat(provider.exists("user001", "byclaw-code-agent", SandboxInfo.builder().sandboxId("sandbox-1").build()))
            .isFalse();
    }
}
