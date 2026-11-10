package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;

@Service
public class SandboxIngressEndpointResolver {

    private static final Logger log = LoggerFactory.getLogger(SandboxIngressEndpointResolver.class);

    private final SandboxService sandboxService;

    public SandboxIngressEndpointResolver(SandboxService sandboxService) {
        this.sandboxService = sandboxService;
    }

    public String resolveRequiredEndpoint(String userCode, String instance) {
        return resolveRequiredEndpoint(userCode, instance, false).endpoint();
    }

    public Endpoint resolveRequiredEndpoint(String userCode, String instance, boolean preferSharedDsh) {
        if (StringUtils.isAnyBlank(userCode, instance)) {
            throw new IllegalStateException("sandbox ingress requires userCode and instance");
        }
        List<SandboxInfo> sandboxes = sandboxService.sandboxInfo(userCode);
        log.debug("Resolving ingress endpoint: userCode={}, instance={}, sandboxCount={}",
            userCode, instance, sandboxes == null ? 0 : sandboxes.size());
        if (sandboxes == null || sandboxes.isEmpty()) {
            throw new IllegalStateException("No running sandbox found for userCode=" + userCode);
        }
        if (preferSharedDsh) {
            String sharedInstance = SandboxLaunchRouting.BYCLAW_DSH_SANDBOX_TYPE;
            for (SandboxInfo sandbox : sandboxes) {
                if (sandbox == null || !Boolean.TRUE.equals(sandbox.getIsShared())) {
                    continue;
                }
                String endpoint = resolveInstanceEndpoint(sandbox.getInstanceEndpoints(), sharedInstance);
                if (endpoint != null) {
                    return new Endpoint(sharedInstance, endpoint, true, sandbox.getGatewayToken(),
                        sandboxService.resolveSharedIngressHeaders(userCode, sandbox, endpoint));
                }
            }
        }
        for (SandboxInfo sandboxInfo : sandboxes) {
            String endpoint = resolveInstanceEndpoint(sandboxInfo != null ? sandboxInfo.getInstanceEndpoints() : null, instance);
            if (StringUtils.isNotBlank(endpoint)) {
                log.debug("Matched ingress endpoint: userCode={}, instance={}, sandboxId={}, endpoint={}",
                    userCode, instance, sandboxInfo != null ? sandboxInfo.getSandboxId() : null, endpoint);
                return new Endpoint(instance, endpoint, false, null, Map.of());
            }
        }
        throw new IllegalStateException("No sandbox endpoint found for userCode=" + userCode + ", instance=" + instance);
    }

    public record Endpoint(String instance, String endpoint, boolean shared, String webToken, Map<String, String> headers) {}

    private String resolveInstanceEndpoint(Map<String, String> instanceEndpoints, String instance) {
        if (instanceEndpoints == null || instanceEndpoints.isEmpty()) {
            return null;
        }
        for (Map.Entry<String, String> entry : instanceEndpoints.entrySet()) {
            if (StringUtils.equalsIgnoreCase(StringUtils.trimToEmpty(entry.getKey()), instance)) {
                return StringUtils.trimToNull(entry.getValue());
            }
        }
        return null;
    }
}
