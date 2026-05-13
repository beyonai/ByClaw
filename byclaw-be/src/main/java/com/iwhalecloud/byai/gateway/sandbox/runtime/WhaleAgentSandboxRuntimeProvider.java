package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.common.feign.client.FeignWhaleAgentService;
import com.iwhalecloud.byai.common.feign.request.sandbox.RenewSandboxTimeoutRequest;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxCreateResult;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ImageSpec;
import com.iwhalecloud.byai.gateway.sandbox.client.model.Volume;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

public class WhaleAgentSandboxRuntimeProvider implements SandboxRuntimeProvider {

    private static final String WHALE_AGENT_SANDBOX_TYPE = "byclaw";

    private final FeignWhaleAgentService feignWhaleAgentService;

    public WhaleAgentSandboxRuntimeProvider(FeignWhaleAgentService feignWhaleAgentService) {
        this.feignWhaleAgentService = feignWhaleAgentService;
    }

    @Override
    public String providerType() {
        return "whale-agent";
    }

    @Override
    public SandboxRuntimeInstance create(CreateSandboxRequest request,
                                         SandboxServiceSpec spec,
                                         String userCode,
                                         String sandboxType,
                                         String idempotencyKey) {
        Map<String, Object> payload = buildPayload(request, spec, userCode, sandboxType, idempotencyKey);
        KnowledgeResponse<SandboxCreateResult> response = feignWhaleAgentService.launchSandbox(payload);
        validateLaunchResponse(response);
        SandboxCreateResult result = response.getResultObject();
        String sandboxId = result != null ? result.getSandboxId() : null;
        String endpoint = result != null ? result.getEndpoint() : null;
        List<String> endpoints = StringUtils.isNotBlank(endpoint) ? List.of(endpoint) : List.of();
        return SandboxRuntimeInstance.builder()
            .sandboxId(StringUtils.defaultIfBlank(sandboxId, userCode + ":" + sandboxType))
            .endpoints(endpoints)
            .build();
    }

    @Override
    public void remove(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo == null || StringUtils.isBlank(sandboxInfo.getSandboxId())) {
            return;
        }
        feignWhaleAgentService.destroySandbox(Map.of("sandboxId", sandboxInfo.getSandboxId()));
    }

    @Override
    public void heartbeat(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo == null
            || StringUtils.isBlank(sandboxInfo.getSandboxId())
            || sandboxInfo.getTimeoutSeconds() == null
            || sandboxInfo.getTimeoutSeconds() <= 0) {
            return;
        }
        KnowledgeResponse<?> response = feignWhaleAgentService.renewSandboxTimeout(
            new RenewSandboxTimeoutRequest(sandboxInfo.getSandboxId(), sandboxInfo.getTimeoutSeconds()));
        validateOperationResponse(response, "WhaleAgent sandbox heartbeat failed");
    }

    private Map<String, Object> buildPayload(CreateSandboxRequest request,
                                             SandboxServiceSpec spec,
                                             String userCode,
                                             String sandboxType,
                                             String idempotencyKey) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("entrypoint", request.getEntrypoint());
        payload.put("env", request.getEnv());
        payload.put("image", buildImagePayload(request.getImage()));
        payload.put("resourceLimits", request.getResourceLimits());
        payload.put("volumes", buildVolumesPayload(request.getVolumes()));
        payload.put("servicePort", resolveServicePort(spec));
        payload.put("sandboxType", WHALE_AGENT_SANDBOX_TYPE);
        return payload;
    }

    private void validateLaunchResponse(KnowledgeResponse<SandboxCreateResult> response) {
        validateOperationResponse(response, "WhaleAgent sandbox launch failed");
        if (response.getResultObject() == null) {
            throw new IllegalStateException("WhaleAgent sandbox resultObject is empty");
        }
    }

    private void validateOperationResponse(KnowledgeResponse<?> response, String defaultMessage) {
        if (response == null) {
            throw new IllegalStateException("WhaleAgent sandbox response is empty");
        }
        if (!KnowledgeResponse.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new IllegalStateException(StringUtils.defaultIfBlank(response.getResultMsg(),
                defaultMessage));
        }
    }

    private int resolveServicePortValue(Integer port) {
        return port != null && port > 0 ? port : 18789;
    }

    private int resolveServicePort(SandboxServiceSpec spec) {
        if (spec != null && spec.getPorts() != null) {
            for (PortSpec port : spec.getPorts()) {
                if (port != null && port.getPort() != null && port.getPort() > 0) {
                    return port.getPort();
                }
            }
        }
        return resolveServicePortValue(null);
    }

    private Map<String, Object> buildImagePayload(ImageSpec imageSpec) {
        if (imageSpec == null) {
            return null;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("uri", imageSpec.getUri());
        return payload;
    }

    private List<Map<String, Object>> buildVolumesPayload(List<Volume> volumes) {
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
