package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.RenewSandboxExpirationRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxEndpoint;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

public class OpenSandboxRuntimeProvider implements SandboxRuntimeProvider {

    private static final Logger log = LoggerFactory.getLogger(OpenSandboxRuntimeProvider.class);

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
        log.info("OpenSandbox 查询可复用沙箱，userCode={}，sandboxType={}", userCode, sandboxType);
        List<SandboxDetail> sandboxes = openSandboxClient.listSandboxes(userCode, sandboxType);
        if (sandboxes == null || sandboxes.isEmpty()) {
            log.info("OpenSandbox 未找到可复用沙箱，userCode={}，sandboxType={}", userCode, sandboxType);
            return Optional.empty();
        }
        Optional<SandboxRuntimeInstance> reusable = sandboxes.stream()
            .filter(Objects::nonNull)
            .filter(d -> d.getId() != null && !d.getId().isBlank())
            .filter(d -> matchesSandboxMetadata(d, userCode, sandboxType))
            .filter(d -> SandboxRuntimeRequestFactory.isReusableSandboxState(d.getStatus()))
            .sorted(this::compareSandboxReusePreference)
            .map(d -> SandboxRuntimeInstance.builder()
                .sandboxId(d.getId())
                .createdAt(d.getCreatedAt())
                .expiresAt(d.getExpiresAt())
                .build())
            .findFirst();
        log.info("OpenSandbox 可复用沙箱查询完成，userCode={}，sandboxType={}，selectedSandboxId={}",
            userCode, sandboxType, reusable.map(SandboxRuntimeInstance::getSandboxId).orElse(null));
        return reusable;
    }

    @Override
    public SandboxRuntimeInstance create(CreateSandboxRequest request,
                                         SandboxServiceSpec spec,
                                         String userCode,
                                         String sandboxType,
                                         String idempotencyKey) {
        log.info("OpenSandbox 创建沙箱，userCode={}，sandboxType={}，idempotencyKey={}", userCode, sandboxType, idempotencyKey);
        SandboxRuntimeRequestFactory.applyIdempotencyMetadata(request, idempotencyKey);
        CreateSandboxResponse response = openSandboxClient.createSandbox(request, idempotencyKey);
        log.info("OpenSandbox 创建沙箱成功，userCode={}，sandboxType={}，sandboxId={}，expiresAt={}",
            userCode, sandboxType, response.getId(), response.getExpiresAt());
        return SandboxRuntimeInstance.builder()
            .sandboxId(response.getId())
            .createdAt(response.getCreatedAt())
            .expiresAt(response.getExpiresAt())
            .build();
    }

    @Override
    public List<String> resolveEndpoints(SandboxRuntimeInstance instance, SandboxServiceSpec spec, CreateSandboxRequest request) {
        if (instance.getEndpoints() != null) {
            log.debug("OpenSandbox 直接返回已有 endpoints，sandboxId={}，endpoints={}",
                instance.getSandboxId(), instance.getEndpoints());
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
        log.info("OpenSandbox 解析 endpoints 完成，sandboxId={}，endpoints={}", instance.getSandboxId(), endpoints);
        return endpoints;
    }

    @Override
    public void remove(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo != null && sandboxInfo.getSandboxId() != null && !sandboxInfo.getSandboxId().isBlank()) {
            log.info("OpenSandbox 删除沙箱，userCode={}，sandboxType={}，sandboxId={}",
                userCode, sandboxType, sandboxInfo.getSandboxId());
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
            log.debug("OpenSandbox 跳过续约，参数不足，userCode={}，sandboxType={}，sandboxId={}，timeoutSeconds={}",
                userCode, sandboxType, sandboxInfo != null ? sandboxInfo.getSandboxId() : null,
                sandboxInfo != null ? sandboxInfo.getTimeoutSeconds() : null);
            return;
        }
        RenewSandboxExpirationRequest request = SandboxRuntimeRequestFactory.buildOpenSandboxRenewRequest(sandboxInfo);
        if (request != null) {
            log.info("OpenSandbox 续约沙箱，userCode={}，sandboxType={}，sandboxId={}，expiresAt={}",
                userCode, sandboxType, sandboxInfo.getSandboxId(), request.getExpiresAt());
            openSandboxClient.renewExpiration(sandboxInfo.getSandboxId(), request);
        }
    }

    @Override
    public boolean exists(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo == null || sandboxInfo.getSandboxId() == null || sandboxInfo.getSandboxId().isBlank()) {
            return false;
        }
        SandboxDetail detail = openSandboxClient.getSandboxIfExists(sandboxInfo.getSandboxId());
        boolean exists = detail != null && SandboxRuntimeRequestFactory.isReusableSandboxState(detail.getStatus());
        log.info("OpenSandbox 查询远端状态，userCode={}，sandboxType={}，sandboxId={}，exists={}，remoteState={}",
            userCode, sandboxType, sandboxInfo.getSandboxId(), exists,
            detail != null && detail.getStatus() != null ? detail.getStatus().getState() : null);
        return exists;
    }

    private static boolean matchesSandboxMetadata(SandboxDetail detail, String userCode, String sandboxType) {
        Map<String, String> metadata = detail.getMetadata();
        return metadata != null
            && Objects.equals(userCode, metadata.get("userCode"))
            && Objects.equals(sandboxType, metadata.get("serviceKey"));
    }

    private int compareSandboxReusePreference(SandboxDetail a, SandboxDetail b) {
        int rankA = SandboxRuntimeRequestFactory.stateRankForReuse(a.getStatus());
        int rankB = SandboxRuntimeRequestFactory.stateRankForReuse(b.getStatus());
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

}
