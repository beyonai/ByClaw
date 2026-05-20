package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.common.feign.request.sandbox.WhaleAgentListSandboxesRequest;
import com.iwhalecloud.byai.common.feign.request.sandbox.RenewSandboxTimeoutRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ImageSpec;
import com.iwhalecloud.byai.gateway.sandbox.client.model.RenewSandboxExpirationRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxStatus;
import com.iwhalecloud.byai.gateway.sandbox.client.model.Volume;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

final class SandboxRuntimeRequestFactory {

    private static final String METADATA_IDEMPOTENCY_KEY = "idempotencyKey";
    private static final String METADATA_GATEWAY_TOKEN = "gateway_token";
    private static final String ENV_GATEWAY_TOKEN = "gateway_token";
    private static final String ENV_OPENCLAW_GATEWAY_TOKEN = "OPENCLAW_GATEWAY_TOKEN";
    private static final int DEFAULT_SERVICE_PORT = 18789;
    private static final int DEFAULT_WHALE_AGENT_LIST_PAGE = 1;
    private static final int DEFAULT_WHALE_AGENT_LIST_PAGE_SIZE = 100;

    private SandboxRuntimeRequestFactory() {
    }

    static CreateSandboxRequest applyRuntimeMetadata(CreateSandboxRequest request, String idempotencyKey) {
        Map<String, String> metadata = new LinkedHashMap<>();
        if (request != null && request.getMetadata() != null) {
            metadata.putAll(request.getMetadata());
        }
        if (StringUtils.isNotBlank(idempotencyKey)) {
            metadata.put(METADATA_IDEMPOTENCY_KEY, idempotencyKey);
        }
        String gatewayToken = extractGatewayToken(request);
        if (StringUtils.isNotBlank(gatewayToken)) {
            metadata.put(METADATA_GATEWAY_TOKEN, gatewayToken);
        }
        if (request != null) {
            request.setMetadata(metadata.isEmpty() ? null : metadata);
        }
        return request;
    }

    static Map<String, Object> buildCommonLaunchPayload(CreateSandboxRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("timeout", request != null ? request.getTimeout() : null);
        payload.put("metadata", request != null ? request.getMetadata() : null);
        payload.put("entrypoint", request != null ? request.getEntrypoint() : null);
        payload.put("env", request != null ? request.getEnv() : null);
        payload.put("image", buildImagePayload(request != null ? request.getImage() : null));
        payload.put("resourceLimits", request != null ? request.getResourceLimits() : null);
        payload.put("volumes", buildVolumesPayload(request != null ? request.getVolumes() : null));
        payload.put("extensions", request != null ? request.getExtensions() : null);
        return payload;
    }

    static Map<String, Object> buildWhaleAgentLaunchPayload(CreateSandboxRequest request,
                                                            SandboxServiceSpec spec,
                                                            String sandboxType) {
        Map<String, Object> payload = buildCommonLaunchPayload(request);
        payload.put("servicePort", resolveServicePort(spec));
        payload.put("sandboxType", sandboxType);
        return payload;
    }

    static RenewSandboxExpirationRequest buildOpenSandboxRenewRequest(SandboxInfo sandboxInfo) {
        if (sandboxInfo == null || sandboxInfo.getTimeoutSeconds() == null || sandboxInfo.getTimeoutSeconds() <= 0) {
            return null;
        }
        OffsetDateTime expiresAt = sandboxInfo.getRemoteExpiresAt() != null
            ? OffsetDateTime.ofInstant(sandboxInfo.getRemoteExpiresAt().toInstant(), ZoneId.systemDefault())
            : OffsetDateTime.now().plusSeconds(sandboxInfo.getTimeoutSeconds());
        return new RenewSandboxExpirationRequest(expiresAt);
    }

    static RenewSandboxTimeoutRequest buildWhaleAgentRenewRequest(SandboxInfo sandboxInfo) {
        if (sandboxInfo == null || sandboxInfo.getTimeoutSeconds() == null || sandboxInfo.getTimeoutSeconds() <= 0) {
            return null;
        }
        return new RenewSandboxTimeoutRequest(sandboxInfo.getSandboxId(), sandboxInfo.getTimeoutSeconds());
    }

    static Map<String, Object> buildSandboxIdRequest(String sandboxId) {
        return Map.of("sandboxId", sandboxId);
    }

    static WhaleAgentListSandboxesRequest buildWhaleAgentListSandboxesRequest(String userCode, String sandboxType) {
        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("userCode", userCode);
        metadata.put("serviceKey", sandboxType);
        return new WhaleAgentListSandboxesRequest(
            DEFAULT_WHALE_AGENT_LIST_PAGE,
            DEFAULT_WHALE_AGENT_LIST_PAGE_SIZE,
            metadata);
    }

    static String extractGatewayToken(CreateSandboxRequest request) {
        if (request == null || request.getEnv() == null || request.getEnv().isEmpty()) {
            return null;
        }
        String gatewayToken = request.getEnv().get(ENV_GATEWAY_TOKEN);
        if (StringUtils.isBlank(gatewayToken)) {
            gatewayToken = request.getEnv().get(ENV_OPENCLAW_GATEWAY_TOKEN);
        }
        return StringUtils.trimToNull(gatewayToken);
    }

    static String resolveGatewayToken(SandboxRuntimeInstance instance, CreateSandboxRequest request) {
        if (instance != null && instance.getMetadata() != null) {
            String gatewayToken = StringUtils.trimToNull(instance.getMetadata().get(METADATA_GATEWAY_TOKEN));
            if (gatewayToken != null) {
                return gatewayToken;
            }
        }
        return extractGatewayToken(request);
    }

    static boolean isReusableSandboxState(SandboxStatus status) {
        if (status == null || StringUtils.isBlank(status.getState())) {
            return true;
        }
        String state = status.getState().trim().toLowerCase(java.util.Locale.ROOT);
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

    static int stateRankForReuse(SandboxStatus status) {
        if (status == null || StringUtils.isBlank(status.getState())) {
            return 0;
        }
        return switch (status.getState().trim().toLowerCase(java.util.Locale.ROOT)) {
            case "running" -> 3;
            case "pending" -> 2;
            default -> 1;
        };
    }

    private static int resolveServicePort(SandboxServiceSpec spec) {
        if (spec != null && spec.getServicePort() != null && spec.getServicePort() > 0) {
            return spec.getServicePort();
        }
        if (spec != null && spec.getPorts() != null) {
            for (PortSpec port : spec.getPorts()) {
                if (port != null && port.getPort() != null && port.getPort() > 0) {
                    return port.getPort();
                }
            }
        }
        return DEFAULT_SERVICE_PORT;
    }

    private static Map<String, Object> buildImagePayload(ImageSpec imageSpec) {
        if (imageSpec == null) {
            return null;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("uri", imageSpec.getUri());
        return payload;
    }

    private static List<Map<String, Object>> buildVolumesPayload(List<Volume> volumes) {
        if (volumes == null || volumes.isEmpty()) {
            return null;
        }
        List<Map<String, Object>> payload = new java.util.ArrayList<>();
        for (Volume volume : volumes) {
            if (volume == null) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("mountPath", volume.getMountPath());
            item.put("name", volume.getName());
            item.put("readOnly", volume.getReadOnly());
            item.put("subPath", volume.getSubPath());
            item.put("scope", volume.getScope());
            payload.add(item);
        }
        return payload.isEmpty() ? null : payload;
    }
}
