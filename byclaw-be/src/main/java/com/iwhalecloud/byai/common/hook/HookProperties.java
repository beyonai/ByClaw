package com.iwhalecloud.byai.common.hook;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Deployment-owned subscriptions; bound only when outbound hooks are enabled. */
@Getter
@Setter
@ConfigurationProperties(prefix = "byclaw.hooks", ignoreUnknownFields = false)
public class HookProperties {
    private boolean enabled;
    private Durable durable = new Durable();

    @Getter
    @Setter
    public static class Durable {
        private boolean enabled;
        private long pollDelayMs = 1000;
    }

    private Defaults defaults = new Defaults();
    private Map<String, Subscription> subscriptions = new LinkedHashMap<>();

    @Getter
    @Setter
    public static class Defaults {
        private Duration connectTimeout = Duration.ofSeconds(2);
        private Duration callTimeout = Duration.ofSeconds(5);
    }

    @Getter
    @Setter
    public static class Subscription {
        private boolean enabled = true;
        private String event;
        private int eventVersion = 1;
        private Http http = new Http();
        private Set<String> requiredDataFields = new LinkedHashSet<>();
        private Retry retry = new Retry();
    }

    @Getter
    @Setter
    public static class Http {
        private String method = "POST";
        private String url;
        private Map<String, String> headers = new LinkedHashMap<>();
        private Auth auth = new Auth();
        private Map<String, Field> body = new LinkedHashMap<>();
    }

    @Getter
    @Setter
    public static class Auth {
        private String type = "none";
        private String token;
        private String clientId;
        private String secret;
        private boolean allowLoopbackHttp;
        private List<Field> canonicalFields = new ArrayList<>();
        private String separator = "\n";
        private Map<String, Field> headers = new LinkedHashMap<>();
    }

    /** Bounded, in-memory retries are opt-in and retain the original event snapshot. */
    @Getter
    @Setter
    public static class Retry {
        private int maxAttempts = 1;
        private Duration delay = Duration.ofSeconds(5);
        private Set<Integer> statuses = Set.of(429, 500, 502, 503, 504);
        private boolean transportErrors = true;
    }

    @Getter
    public static class Field {
        @Setter private String from;
        private Object value;
        private boolean valuePresent;

        /** Distinguish an explicitly configured constant from a missing mapping. */
        public void setValue(Object value) {
            this.value = value;
            this.valuePresent = true;
        }
    }
}
