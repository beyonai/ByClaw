package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceProfileEntityMapper;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Reads current table defaults only when reserving a new tenant; retries use the frozen snapshot. */
@Component
public class TenantSandboxProperties {
    private final SandboxServiceSpecEntityMapper specs;
    private final SandboxServiceProfileEntityMapper profiles;

    public TenantSandboxProperties(SandboxServiceSpecEntityMapper specs, SandboxServiceProfileEntityMapper profiles) {
        this.specs = specs;
        this.profiles = profiles;
    }

    public String getProfileKey() {
        return profile("tenant-opengauss");
    }

    public String getNodeProfileKey() {
        return profile("tenant-data-node");
    }

    private ResponseStatusException unavailable(String service) {
        return new ResponseStatusException(HttpStatus.CONFLICT, "tenant-data-node".equals(service)
            ? "tenant.node.profile.unavailable" : "tenant.database.profile.unavailable");
    }

    private String profile(String service) {
        var spec = specs.selectProfileAwareByServiceKey(service);
        if (spec == null || !Integer.valueOf(1).equals(spec.getEnabled()) || !"TENANT".equals(spec.getOwnerScope())
            || !Set.of("s", "m", "l").contains(spec.getDefaultProfileKey() == null ? "" : spec.getDefaultProfileKey()))
            throw unavailable(service);
        String type = spec.getServiceType() == null || spec.getServiceType().isBlank() ? service : spec.getServiceType();
        if (profiles.selectEnabledProfile(type, spec.getDefaultProfileKey()) == null)
            throw unavailable(service);
        return spec.getDefaultProfileKey();
    }
}
