package com.iwhalecloud.byai.common.integration.security;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;

/** Disabled by default; secrets must be supplied by deployment configuration. */
@Getter @Setter @Component
@ConfigurationProperties(prefix = "byclaw.integration.security")
public class InternalServiceSecurityProperties {
    private boolean enabled;
    private long maxSkewSeconds = 300;
    private Map<String, Client> clients = new HashMap<>();
    @Getter @Setter
    public static class Client {
        private String secret;
        private String sourceSystem;
        private Set<String> scopes = Set.of();
        private Set<String> enterpriseIds = Set.of();
        private boolean allTenants;
    }
}
