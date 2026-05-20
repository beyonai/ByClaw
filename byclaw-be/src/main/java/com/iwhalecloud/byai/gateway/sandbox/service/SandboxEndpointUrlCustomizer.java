package com.iwhalecloud.byai.gateway.sandbox.service;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxImageType;

class SandboxEndpointUrlCustomizer {

    private final String sandboxGatewayToken;

    SandboxEndpointUrlCustomizer(String sandboxGatewayToken) {
        this.sandboxGatewayToken = sandboxGatewayToken;
    }

    String toAccessEndpoint(String endpoint, String imageType) {
        if (StringUtils.isBlank(endpoint)) {
            return endpoint;
        }
        if (StringUtils.isBlank(sandboxGatewayToken)) {
            return SandboxImageType.isUiAgent(imageType) ? endpoint : StringUtils.removeEnd(endpoint, "/") + "/chat";
        }
        String accessEndpoint = SandboxImageType.isUiAgent(imageType)
            ? endpoint : StringUtils.removeEnd(endpoint, "/") + "/chat";
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
