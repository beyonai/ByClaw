package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.util.Objects;

public class SandboxCronPrewarmTarget {

    private final String userCode;

    private final String serviceKey;

    private final Long resourceId;

    public SandboxCronPrewarmTarget(String userCode, String serviceKey, Long resourceId) {
        this.userCode = userCode;
        this.serviceKey = serviceKey;
        this.resourceId = resourceId;
    }

    public String getUserCode() {
        return userCode;
    }

    public String getServiceKey() {
        return serviceKey;
    }

    public Long getResourceId() {
        return resourceId;
    }

    public String toLogKey() {
        return userCode + "/" + serviceKey + "/" + resourceId;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof SandboxCronPrewarmTarget target)) {
            return false;
        }
        return Objects.equals(userCode, target.userCode)
            && Objects.equals(serviceKey, target.serviceKey)
            && Objects.equals(resourceId, target.resourceId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(userCode, serviceKey, resourceId);
    }
}
