package com.iwhalecloud.byai.gateway.sandbox.service;

import java.net.URI;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxImageType;

class SandboxEndpointRegistryTargetResolver {

    SandboxEndpointRegistryTarget resolve(String endpoint, String imageType, String sandboxId, Integer servicePort) {
        URI uri = URI.create(StringUtils.trimToEmpty(endpoint));
        String protocol = StringUtils.defaultIfBlank(uri.getScheme(), "http");
        String host = StringUtils.trimToEmpty(uri.getHost());
        if (StringUtils.isBlank(host)) {
            throw new IllegalArgumentException("endpoint host is blank: " + endpoint);
        }
        int port = resolveEndpointPort(uri);
        if (port <= 0) {
            throw new IllegalArgumentException("endpoint port is invalid: " + endpoint);
        }
        return new SandboxEndpointRegistryTarget(protocol, host, port,
            resolvePathPrefix(uri, imageType, sandboxId, servicePort));
    }

    private String resolvePathPrefix(URI uri, String imageType, String sandboxId, Integer servicePort) {
        if (!SandboxImageType.isUiAgent(imageType)) {
            return "/";
        }
        if (StringUtils.isNotBlank(sandboxId) && servicePort != null && servicePort > 0) {
            return "sandboxes/" + sandboxId + "/proxy/" + servicePort + "/";
        }
        String path = StringUtils.removeStart(StringUtils.defaultString(uri.getPath()), "/");
        if (StringUtils.isBlank(path)) {
            throw new IllegalArgumentException("uiagent registry pathPrefix is blank");
        }
        return StringUtils.appendIfMissing(path, "/");
    }

    private int resolveEndpointPort(URI uri) {
        if (uri.getPort() > 0) {
            return uri.getPort();
        }
        if (StringUtils.equalsIgnoreCase(uri.getScheme(), "http")) {
            return 80;
        }
        if (StringUtils.equalsIgnoreCase(uri.getScheme(), "https")) {
            return 443;
        }
        return -1;
    }
}
