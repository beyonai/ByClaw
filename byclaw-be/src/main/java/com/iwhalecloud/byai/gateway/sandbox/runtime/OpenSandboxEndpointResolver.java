package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxEndpoint;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.support.SandboxEndpointRecordSupport;

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
        Map<String, String> instanceEndpoints = resolveConfiguredInstanceEndpoints(instance, spec);
        if (!instanceEndpoints.isEmpty()) {
            instance.setInstanceEndpoints(instanceEndpoints);
        }
        List<String> endpoints;
        if (spec != null && spec.getServicePort() != null) {
            String primaryEndpoint = resolvePrimaryEndpoint(instanceEndpoints, spec);
            endpoints = StringUtils.isNotBlank(primaryEndpoint) ? List.of(primaryEndpoint) : List.of();
        } else if (instance.getEndpoints() != null) {
            endpoints = instance.getEndpoints();
        } else {
            endpoints = new ArrayList<>(instanceEndpoints.values());
        }
        instance.setEndpoints(endpoints);
        return endpoints;
    }

    private Map<String, String> resolveConfiguredInstanceEndpoints(SandboxRuntimeInstance instance, SandboxServiceSpec spec) {
        List<PortSpec> ports = resolveConfiguredPorts(spec);
        if (ports.isEmpty()) {
            return Map.of();
        }
        LinkedHashMap<String, String> endpoints = new LinkedHashMap<>();
        for (PortSpec port : ports) {
            if (port == null || port.getPort() == null) {
                continue;
            }
            String endpoint = resolveEndpointForPort(instance, port, spec);
            if (StringUtils.isBlank(endpoint)) {
                continue;
            }
            endpoints.put(resolveInstanceName(spec, port), endpoint);
        }
        return SandboxEndpointRecordSupport.normalizeInstanceEndpoints(endpoints);
    }

    private String resolveEndpointForPort(SandboxRuntimeInstance instance, PortSpec portSpec, SandboxServiceSpec spec) {
        int port = portSpec.getPort();
        String instanceName = resolveInstanceName(spec, portSpec);
        SandboxEndpoint endpoint = openSandboxClient.getSandboxEndpoint(instance.getSandboxId(), port);
        captureEndpointHeaders(instance, endpoint);
        String rawEndpoint = endpoint != null ? endpoint.getEndpoint() : null;
        if (StringUtils.equalsIgnoreCase(instanceName, SandboxEndpointRecordSupport.OPENCLAW_INSTANCE)) {
            return applyProtocol(rawEndpoint, portSpec.getProtocol());
        }
        return buildIngressEndpoint(instanceName, instance != null ? instance.getSandboxId() : null, port);
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
        portSpec.setProtocol(protocolForPrimaryPort(spec));
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
        List<PortSpec> ports = resolveConfiguredPorts(spec);
        for (PortSpec port : ports) {
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

    private String buildIngressEndpoint(String instanceName, String sandboxId, int port) {
        if (StringUtils.isBlank(instanceName) || StringUtils.isBlank(sandboxId)) {
            return null;
        }
        String encodedInstance = URLEncoder.encode(instanceName, StandardCharsets.UTF_8).replace("+", "%20");
        String encodedSandboxId = URLEncoder.encode(sandboxId, StandardCharsets.UTF_8).replace("+", "%20");
        return "/sandboxes/ingress/" + encodedInstance + "/" + encodedSandboxId + "/proxy/" + port;
    }
}
