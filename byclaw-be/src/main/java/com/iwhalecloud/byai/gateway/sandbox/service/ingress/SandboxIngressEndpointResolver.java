package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;

@Service
public class SandboxIngressEndpointResolver {

    private static final Logger log = LoggerFactory.getLogger(SandboxIngressEndpointResolver.class);

    private final SandboxService sandboxService;

    public SandboxIngressEndpointResolver(SandboxService sandboxService) {
        this.sandboxService = sandboxService;
    }

    public String resolveRequiredEndpoint(String userCode, String instance) {
        if (StringUtils.isAnyBlank(userCode, instance)) {
            throw new IllegalStateException("sandbox ingress requires userCode and instance");
        }
        List<SandboxInfo> sandboxes = sandboxService.sandboxInfo(userCode);
        log.debug("Resolving ingress endpoint: userCode={}, instance={}, sandboxCount={}",
            userCode, instance, sandboxes == null ? 0 : sandboxes.size());
        if (sandboxes == null || sandboxes.isEmpty()) {
            throw new IllegalStateException("No running sandbox found for userCode=" + userCode);
        }
        for (SandboxInfo sandboxInfo : sandboxes) {
            String endpoint = resolveInstanceEndpoint(sandboxInfo != null ? sandboxInfo.getInstanceEndpoints() : null, instance);
            if (StringUtils.isNotBlank(endpoint)) {
                log.debug("Matched ingress endpoint: userCode={}, instance={}, sandboxId={}, endpoint={}",
                    userCode, instance, sandboxInfo != null ? sandboxInfo.getSandboxId() : null, endpoint);
                return endpoint;
            }
        }
        throw new IllegalStateException("No sandbox endpoint found for userCode=" + userCode + ", instance=" + instance);
    }

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
