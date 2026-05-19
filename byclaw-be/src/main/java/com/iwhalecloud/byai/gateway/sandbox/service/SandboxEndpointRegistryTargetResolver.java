package com.iwhalecloud.byai.gateway.sandbox.service;

import java.net.URI;

import org.apache.commons.lang3.StringUtils;

class SandboxEndpointRegistryTargetResolver {

    SandboxEndpointRegistryTarget resolve(String endpoint) {
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
        return new SandboxEndpointRegistryTarget(protocol, host, port, "/");
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
