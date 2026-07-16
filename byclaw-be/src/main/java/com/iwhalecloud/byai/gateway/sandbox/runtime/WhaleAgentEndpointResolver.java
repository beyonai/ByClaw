package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.iwhalecloud.byai.common.feign.client.FeignWhaleAgentService;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.support.SandboxEndpointRecordSupport;

/**
 * Rehydrates proxy endpoints for WhaleAgent sandboxes discovered via
 * {@code findReusable} / {@code getSandbox}, whose {@code SandboxDetail} does
 * not carry any endpoint field. Calls
 * {@code /sandboxExternal/getSandboxEndpoint} once per port declared in the
 * service spec — mirrors the shape of {@link OpenSandboxEndpointResolver}.
 */
class WhaleAgentEndpointResolver {

    private static final Logger log = LoggerFactory.getLogger(WhaleAgentEndpointResolver.class);

    private final FeignWhaleAgentService feignWhaleAgentService;

    WhaleAgentEndpointResolver(FeignWhaleAgentService feignWhaleAgentService) {
        this.feignWhaleAgentService = feignWhaleAgentService;
    }

    List<String> resolve(SandboxRuntimeInstance instance, SandboxServiceSpec spec, String sandboxType) {
        if (instance == null || StringUtils.isBlank(instance.getSandboxId())) {
            return List.of();
        }
        List<PortSpec> ports = resolveConfiguredPorts(spec);
        if (ports.isEmpty()) {
            return List.of();
        }

        LinkedHashMap<String, String> instanceEndpoints = new LinkedHashMap<>();
        for (PortSpec port : ports) {
            if (port == null || port.getPort() == null || port.getPort() <= 0) {
                continue;
            }
            String endpoint = fetchEndpoint(instance.getSandboxId(), sandboxType, port.getPort());
            if (StringUtils.isBlank(endpoint)) {
                continue;
            }
            instanceEndpoints.put(resolveInstanceName(spec, port), applyProtocol(endpoint, port.getProtocol()));
        }

        LinkedHashMap<String, String> normalized = SandboxEndpointRecordSupport
            .normalizeInstanceEndpoints(instanceEndpoints);
        if (!normalized.isEmpty()) {
            instance.setInstanceEndpoints(normalized);
        }

        List<String> endpoints;
        if (spec != null && spec.getServicePort() != null) {
            String primary = resolvePrimaryEndpoint(normalized, spec);
            endpoints = StringUtils.isNotBlank(primary) ? List.of(primary) : List.of();
        } else {
            endpoints = new ArrayList<>(normalized.values());
        }
        instance.setEndpoints(endpoints);
        return endpoints;
    }

    private String fetchEndpoint(String sandboxId, String sandboxType, int port) {
        try {
            KnowledgeResponse<String> response = feignWhaleAgentService.getSandboxEndpoint(
                SandboxRuntimeRequestFactory.buildWhaleAgentGetEndpointRequest(sandboxId, sandboxType, port));
            if (response == null || !KnowledgeResponse.RESPONSE_SUCCESS.equals(response.getResultCode())) {
                log.warn("WhaleAgent getSandboxEndpoint 返回失败，sandboxId={}，port={}，resultCode={}，resultMsg={}",
                    sandboxId, port,
                    response != null ? response.getResultCode() : null,
                    response != null ? response.getResultMsg() : null);
                return null;
            }
            return StringUtils.trimToNull(response.getResultObject());
        } catch (Exception e) {
            log.warn("WhaleAgent getSandboxEndpoint 调用异常，sandboxId={}，port={}，reason={}",
                sandboxId, port, e.getMessage());
            return null;
        }
    }

    private List<PortSpec> resolveConfiguredPorts(SandboxServiceSpec spec) {
        if (spec != null && spec.getPorts() != null && !spec.getPorts().isEmpty()) {
            return spec.getPorts();
        }
        if (spec == null || spec.getServicePort() == null) {
            return List.of();
        }
        PortSpec portSpec = new PortSpec();
        portSpec.setPort(spec.getServicePort());
        portSpec.setInstance(SandboxEndpointRecordSupport.OPENCLAW_INSTANCE);
        return List.of(portSpec);
    }

    private String resolveInstanceName(SandboxServiceSpec spec, PortSpec port) {
        if (port != null && StringUtils.isNotBlank(port.getInstance())) {
            return port.getInstance().trim();
        }
        if (spec != null && port != null && port.getPort() != null
            && port.getPort().equals(spec.getServicePort())) {
            return SandboxEndpointRecordSupport.OPENCLAW_INSTANCE;
        }
        return "port-" + (port != null ? port.getPort() : "unknown");
    }

    private String resolvePrimaryEndpoint(Map<String, String> instanceEndpoints, SandboxServiceSpec spec) {
        if (spec == null || spec.getServicePort() == null) {
            return SandboxEndpointRecordSupport.resolvePrimaryEndpoint(instanceEndpoints);
        }
        for (PortSpec port : resolveConfiguredPorts(spec)) {
            if (port == null || !spec.getServicePort().equals(port.getPort())) {
                continue;
            }
            String endpoint = instanceEndpoints.get(resolveInstanceName(spec, port));
            if (StringUtils.isNotBlank(endpoint)) {
                return endpoint;
            }
        }
        return SandboxEndpointRecordSupport.resolvePrimaryEndpoint(instanceEndpoints);
    }

    private String applyProtocol(String endpoint, String protocol) {
        if (endpoint == null
            || endpoint.startsWith("http://")
            || endpoint.startsWith("https://")
            || StringUtils.isBlank(protocol)) {
            return endpoint;
        }
        return protocol + "://" + endpoint;
    }
}
