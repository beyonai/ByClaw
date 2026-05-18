package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxEndpoint;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxImageType;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

class OpenSandboxEndpointResolver {

    private final OpenSandboxClient openSandboxClient;
    private final SandboxProperties properties;

    OpenSandboxEndpointResolver(OpenSandboxClient openSandboxClient, SandboxProperties properties) {
        this.openSandboxClient = openSandboxClient;
        this.properties = properties;
    }

    List<String> resolve(SandboxRuntimeInstance instance, SandboxServiceSpec spec) {
        if (instance == null) {
            return List.of();
        }
        String imageType = spec != null ? spec.getImageType() : null;
        List<String> endpoints;
        if (SandboxImageType.isUiAgent(imageType)) {
            endpoints = List.of(buildUiAgentEndpoint(instance.getSandboxId(), resolveRequiredServicePort(spec)));
        }
        else if (SandboxImageType.isOpenclaw(imageType)
            && spec != null && spec.getServicePort() != null) {
            endpoints = List.of(resolveEndpointForPort(instance, spec.getServicePort(), protocolForPrimaryPort(spec)));
        }
        else if (instance.getEndpoints() != null) {
            endpoints = instance.getEndpoints();
        }
        else {
            endpoints = resolveConfiguredPortEndpoints(instance, spec);
        }
        instance.setEndpoints(endpoints);
        return endpoints;
    }

    private List<String> resolveConfiguredPortEndpoints(SandboxRuntimeInstance instance, SandboxServiceSpec spec) {
        if (spec == null || spec.getPorts() == null) {
            return List.of();
        }
        List<String> endpoints = new ArrayList<>();
        for (PortSpec port : spec.getPorts()) {
            if (port == null || port.getPort() == null) {
                continue;
            }
            endpoints.add(resolveEndpointForPort(instance, port.getPort(), port.getProtocol()));
        }
        return endpoints;
    }

    private String resolveEndpointForPort(SandboxRuntimeInstance instance, int port, String protocol) {
        SandboxEndpoint endpoint = openSandboxClient.getSandboxEndpoint(instance.getSandboxId(), port);
        captureEndpointHeaders(instance, endpoint);
        return applyProtocol(endpoint != null ? endpoint.getEndpoint() : null, protocol);
    }

    private void captureEndpointHeaders(SandboxRuntimeInstance instance, SandboxEndpoint endpoint) {
        if (endpoint == null || instance.getEndpointHeaders() != null) {
            return;
        }
        Map<String, String> headers = endpoint.getHeaders();
        if (headers != null && !headers.isEmpty()) {
            instance.setEndpointHeaders(headers);
        }
    }

    private String buildUiAgentEndpoint(String sandboxId, int servicePort) {
        if (StringUtils.isBlank(sandboxId)) {
            throw new IllegalArgumentException("sandboxId is required for uiagent endpoint");
        }
        String baseUrl = properties != null && properties.getOpensandbox() != null
            ? properties.getOpensandbox().getUiAgentProxyBaseUrl() : null;
        if (StringUtils.isBlank(baseUrl)) {
            throw new IllegalArgumentException("byclaw.sandbox.opensandbox.ui-agent-proxy-base-url is required for uiagent");
        }
        return StringUtils.removeEnd(baseUrl.trim(), "/")
            + "/" + sandboxId + "/proxy/" + servicePort + "/";
    }

    private int resolveRequiredServicePort(SandboxServiceSpec spec) {
        if (spec == null || spec.getServicePort() == null || spec.getServicePort() <= 0) {
            throw new IllegalArgumentException("spec.servicePort is required for uiagent");
        }
        return spec.getServicePort();
    }

    private String protocolForPort(SandboxServiceSpec spec, Integer servicePort) {
        if (spec == null || servicePort == null || spec.getPorts() == null) {
            return null;
        }
        return spec.getPorts().stream()
            .filter(port -> port != null && servicePort.equals(port.getPort()))
            .map(PortSpec::getProtocol)
            .filter(StringUtils::isNotBlank)
            .findFirst()
            .orElse(null);
    }

    private String protocolForPrimaryPort(SandboxServiceSpec spec) {
        String protocol = protocolForPort(spec, spec != null ? spec.getServicePort() : null);
        if (StringUtils.isNotBlank(protocol)) {
            return protocol;
        }
        return properties != null && properties.getOpensandbox() != null
            ? properties.getOpensandbox().getEndpointScheme() : null;
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
