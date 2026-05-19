package com.iwhalecloud.byai.gateway.sandbox.service;

import org.apache.commons.lang3.StringUtils;

class SandboxEndpointUrlCustomizer {

    private final String sandboxGatewayToken;

    SandboxEndpointUrlCustomizer(String sandboxGatewayToken) {
        this.sandboxGatewayToken = sandboxGatewayToken;
    }

    String toAccessEndpoint(String endpoint) {
        if (StringUtils.isBlank(endpoint)) {
            return endpoint;
        }
        String accessEndpoint = StringUtils.removeEnd(endpoint, "/") + "/chat";
        if (StringUtils.isBlank(sandboxGatewayToken)) {
            return accessEndpoint;
        }
        return appendToken(accessEndpoint);
    }

    private String appendToken(String endpoint) {
        int fragmentIndex = endpoint.indexOf('#');
        String base = fragmentIndex >= 0 ? endpoint.substring(0, fragmentIndex) : endpoint;
        String fragment = fragmentIndex >= 0 ? endpoint.substring(fragmentIndex) : "";
        String separator = base.contains("?") ? "&" : "?";
        return base + separator + "token=" + sandboxGatewayToken + fragment;
    }
}
