package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import org.springframework.util.StringUtils;

public enum SandboxIngressInstanceType {

    FILEBROWSER,
    UNKNOWN;

    public static SandboxIngressInstanceType from(String value) {
        if (!StringUtils.hasText(value)) {
            return UNKNOWN;
        }
        for (SandboxIngressInstanceType type : values()) {
            if (type.name().equalsIgnoreCase(value.trim())) {
                return type;
            }
        }
        return UNKNOWN;
    }
}
