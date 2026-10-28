package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Startup default for newly reserved tenant resources, independent of commercial package limits. */
@Component
@ConfigurationProperties(prefix = "byclaw.tenant.sandbox")
public class TenantSandboxProperties {
    private String profileKey = "m";

    public String getProfileKey() {
        return profileKey;
    }

    public void setProfileKey(String profileKey) {
        // Reject deployment mistakes during binding instead of persisting unusable tenant snapshots.
        if (profileKey == null || !Set.of("s", "m", "l").contains(profileKey)) {
            throw new IllegalArgumentException("byclaw.tenant.sandbox.profile-key must be one of s, m, l");
        }
        this.profileKey = profileKey;
    }
}
