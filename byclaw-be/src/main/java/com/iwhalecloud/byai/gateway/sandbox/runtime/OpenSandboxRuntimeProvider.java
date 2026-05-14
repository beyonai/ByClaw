package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.RenewSandboxExpirationRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxEndpoint;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxStatus;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

public class OpenSandboxRuntimeProvider implements SandboxRuntimeProvider {

    private final OpenSandboxClient openSandboxClient;

    public OpenSandboxRuntimeProvider(OpenSandboxClient openSandboxClient) {
        this.openSandboxClient = openSandboxClient;
    }

    @Override
    public String providerType() {
        return "opensandbox";
    }

    @Override
    public Optional<SandboxRuntimeInstance> findReusable(String userCode, String sandboxType) {
        List<SandboxDetail> sandboxes = openSandboxClient.listSandboxes(userCode, sandboxType);
        if (sandboxes == null || sandboxes.isEmpty()) {
            return Optional.empty();
        }
        return sandboxes.stream()
            .filter(Objects::nonNull)
            .filter(d -> d.getId() != null && !d.getId().isBlank())
            .filter(d -> matchesSandboxMetadata(d, userCode, sandboxType))
            .filter(d -> isReusableSandboxState(d.getStatus()))
            .sorted(this::compareSandboxReusePreference)
            .map(d -> SandboxRuntimeInstance.builder()
                .sandboxId(d.getId())
                .createdAt(d.getCreatedAt())
                .expiresAt(d.getExpiresAt())
                .build())
            .findFirst();
    }

    @Override
    public SandboxRuntimeInstance create(CreateSandboxRequest request,
                                         SandboxServiceSpec spec,
                                         String userCode,
                                         String sandboxType,
                                         String idempotencyKey) {
        Map<String, String> meta = new LinkedHashMap<>();
        if (request.getMetadata() != null) {
            meta.putAll(request.getMetadata());
        }
        meta.put("idempotencyKey", idempotencyKey);
        request.setMetadata(meta);
        CreateSandboxResponse response = openSandboxClient.createSandbox(request, idempotencyKey);
        return SandboxRuntimeInstance.builder()
            .sandboxId(response.getId())
            .createdAt(response.getCreatedAt())
            .expiresAt(response.getExpiresAt())
            .build();
    }

    @Override
    public List<String> resolveEndpoints(SandboxRuntimeInstance instance, SandboxServiceSpec spec, CreateSandboxRequest request) {
        if (instance.getEndpoints() != null) {
            return instance.getEndpoints();
        }
        java.util.ArrayList<String> endpoints = new java.util.ArrayList<>();
        Map<String, String> endpointHeaders = null;
        if (spec.getPorts() != null) {
            for (PortSpec port : spec.getPorts()) {
                if (port == null || port.getPort() == null) {
                    continue;
                }
                SandboxEndpoint endpoint = openSandboxClient.getSandboxEndpoint(instance.getSandboxId(), port.getPort());
                if (endpointHeaders == null) {
                    endpointHeaders = endpoint.getHeaders();
                    instance.setEndpointHeaders(endpointHeaders);
                }
                String endpointResult = endpoint.getEndpoint();
                String protocol = port.getProtocol();
                if (endpointResult != null
                    && !endpointResult.startsWith("http://")
                    && !endpointResult.startsWith("https://")
                    && protocol != null
                    && !protocol.isBlank()) {
                    endpointResult = protocol + "://" + endpointResult;
                }
                endpoints.add(endpointResult);
            }
        }
        instance.setEndpoints(endpoints);
        return endpoints;
    }

    @Override
    public void remove(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo != null && sandboxInfo.getSandboxId() != null && !sandboxInfo.getSandboxId().isBlank()) {
            openSandboxClient.deleteSandbox(sandboxInfo.getSandboxId());
        }
    }

    @Override
    public void heartbeat(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo == null
            || sandboxInfo.getSandboxId() == null
            || sandboxInfo.getSandboxId().isBlank()
            || sandboxInfo.getTimeoutSeconds() == null
            || sandboxInfo.getTimeoutSeconds() <= 0) {
            return;
        }
        OffsetDateTime newExpiresAt = OffsetDateTime.now().plusSeconds(sandboxInfo.getTimeoutSeconds());
        openSandboxClient.renewExpiration(sandboxInfo.getSandboxId(), new RenewSandboxExpirationRequest(newExpiresAt));
    }

    @Override
    public boolean exists(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo == null || sandboxInfo.getSandboxId() == null || sandboxInfo.getSandboxId().isBlank()) {
            return false;
        }
        SandboxDetail detail = openSandboxClient.getSandboxIfExists(sandboxInfo.getSandboxId());
        return detail != null && isReusableSandboxState(detail.getStatus());
    }

    private static boolean matchesSandboxMetadata(SandboxDetail detail, String userCode, String sandboxType) {
        Map<String, String> metadata = detail.getMetadata();
        return metadata != null
            && Objects.equals(userCode, metadata.get("userCode"))
            && Objects.equals(sandboxType, metadata.get("serviceKey"));
    }

    private static boolean isReusableSandboxState(SandboxStatus status) {
        if (status == null || status.getState() == null || status.getState().isBlank()) {
            return true;
        }
        String state = status.getState().trim().toLowerCase(Locale.ROOT);
        return !"failed".equals(state)
            && !"exited".equals(state)
            && !"exit".equals(state)
            && !"stopped".equals(state)
            && !"terminated".equals(state)
            && !"deleted".equals(state)
            && !"removed".equals(state)
            && !"canceled".equals(state)
            && !"cancelled".equals(state);
    }

    private int compareSandboxReusePreference(SandboxDetail a, SandboxDetail b) {
        int rankA = stateRankForReuse(a.getStatus());
        int rankB = stateRankForReuse(b.getStatus());
        if (rankA != rankB) {
            return Integer.compare(rankB, rankA);
        }
        if (a.getCreatedAt() == null && b.getCreatedAt() == null) {
            return 0;
        }
        if (a.getCreatedAt() == null) {
            return 1;
        }
        if (b.getCreatedAt() == null) {
            return -1;
        }
        return b.getCreatedAt().compareTo(a.getCreatedAt());
    }

    private static int stateRankForReuse(SandboxStatus status) {
        if (status == null || status.getState() == null || status.getState().isBlank()) {
            return 0;
        }
        return switch (status.getState().trim().toLowerCase(Locale.ROOT)) {
            case "running" -> 3;
            case "pending" -> 2;
            default -> 1;
        };
    }
}
