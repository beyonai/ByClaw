package com.iwhalecloud.byai.gateway.sandbox.service;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxImageType;

class SandboxEndpointUrlCustomizer {

    private final String sandboxGatewayToken;

    SandboxEndpointUrlCustomizer(String sandboxGatewayToken) {
        this.sandboxGatewayToken = sandboxGatewayToken;
    }

    String toAccessEndpoint(String endpoint, String imageType) {
        if (StringUtils.isBlank(endpoint) || SandboxImageType.isUiAgent(imageType)) {
            return endpoint;
        }
        String chatEndpoint = StringUtils.removeEnd(endpoint, "/") + "/chat";
        if (StringUtils.isBlank(sandboxGatewayToken)) {
            return chatEndpoint;
        }
        return chatEndpoint + "?token=" + sandboxGatewayToken;
    }
}
