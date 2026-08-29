package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "channel.stream")
@Data
public class DingtalkStreamProperties {

    private boolean enabled;

    private boolean showReasoning;

    private Lifecycle lifecycle = new Lifecycle();

    @Data
    public static class Lifecycle {

        private List<Long> startRetryDelaysMillis = List.of(1_000L, 2_000L, 4_000L);

        private int maxStartAttempts = 4;

        private long reconciliationDelaySeconds = 60L;

        private long leaseTtlSeconds = 90L;

        private long leaseRenewIntervalSeconds = 30L;

        private long forceRequestTtlSeconds = 600L;

        private long shutdownTimeoutSeconds = 30L;
    }

}
