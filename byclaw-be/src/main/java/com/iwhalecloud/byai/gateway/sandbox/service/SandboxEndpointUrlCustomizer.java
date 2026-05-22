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
        return bindToken(accessEndpoint);
    }

    String bindToken(String endpoint) {
        if (StringUtils.isBlank(endpoint) || StringUtils.isBlank(sandboxGatewayToken)) {
            return endpoint;
        }
        return replaceOrAppendToken(endpoint);
    }

    private String replaceOrAppendToken(String endpoint) {
        int fragmentIndex = endpoint.indexOf('#');
        String base = fragmentIndex >= 0 ? endpoint.substring(0, fragmentIndex) : endpoint;
        String fragment = fragmentIndex >= 0 ? endpoint.substring(fragmentIndex) : "";
        String[] baseAndQuery = base.split("\\?", 2);
        String path = baseAndQuery[0];
        String query = baseAndQuery.length > 1 ? baseAndQuery[1] : "";
        StringBuilder rebuilt = new StringBuilder(path);
        boolean appended = false;
        if (StringUtils.isNotBlank(query)) {
            for (String pair : query.split("&")) {
                if (StringUtils.isBlank(pair) || pair.startsWith("token=")) {
                    continue;
                }
                rebuilt.append(appended ? '&' : '?').append(pair);
                appended = true;
            }
        }
        rebuilt.append(appended ? '&' : '?').append("token=").append(sandboxGatewayToken);
        return rebuilt.append(fragment).toString();
    }
}
