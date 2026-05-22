package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

class SandboxEndpointRegistryMetadataFactory {

    static final String AUTH_TYPE_KEY = "authType";
    static final String AUTH_PARAM_KEY = "authParam";
    static final String TOKEN_KEY = "token";
    static final String QUERY_AUTH_TYPE = "query";
    static final String TOKEN_PARAM_NAME = "token";

    private final String sandboxGatewayToken;

    SandboxEndpointRegistryMetadataFactory(String sandboxGatewayToken) {
        this.sandboxGatewayToken = sandboxGatewayToken;
    }

    Map<String, Object> build() {
        if (StringUtils.isBlank(sandboxGatewayToken)) {
            return null;
        }
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put(AUTH_TYPE_KEY, QUERY_AUTH_TYPE);
        metadata.put(AUTH_PARAM_KEY, TOKEN_PARAM_NAME);
        metadata.put(TOKEN_KEY, sandboxGatewayToken);
        return metadata;
    }
}
