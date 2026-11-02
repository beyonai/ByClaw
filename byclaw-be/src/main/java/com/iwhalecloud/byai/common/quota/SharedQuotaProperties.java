package com.iwhalecloud.byai.common.quota;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Shared namespace deliberately has no deployment environment segment. */
@Component
@ConfigurationProperties(prefix = "byai.quota.redis")
public class SharedQuotaProperties {
    private String keyPrefix = "byclaw:shared:quota:v1:";
    private FailurePolicy failurePolicy = FailurePolicy.ALLOW;
    private boolean commercialManaged;
    public String getKeyPrefix() { return keyPrefix; }
    public void setKeyPrefix(String keyPrefix) {
        if (keyPrefix == null || keyPrefix.isBlank()) throw new IllegalArgumentException("Quota key prefix is required");
        this.keyPrefix = keyPrefix;
    }
    public FailurePolicy getFailurePolicy() { return failurePolicy; }
    public void setFailurePolicy(FailurePolicy failurePolicy) {
        if (failurePolicy == null) throw new IllegalArgumentException("Quota Redis failure policy is required");
        this.failurePolicy = failurePolicy;
    }
    public enum FailurePolicy { ALLOW, REJECT }
    public boolean isCommercialManaged() { return commercialManaged; }
    public void setCommercialManaged(boolean commercialManaged) { this.commercialManaged = commercialManaged; }
}
