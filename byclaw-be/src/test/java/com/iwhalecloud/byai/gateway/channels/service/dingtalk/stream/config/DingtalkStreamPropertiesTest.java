package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DingtalkStreamPropertiesTest {

    @Test
    void lifecycleDefaultsMatchTheApprovedDesign() {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();

        assertThat(properties.getLifecycle().getStartRetryDelaysMillis())
                .containsExactlyElementsOf(List.of(1_000L, 2_000L, 4_000L));
        assertThat(properties.getLifecycle().getMaxStartAttempts()).isEqualTo(4);
        assertThat(properties.getLifecycle().getReconciliationDelaySeconds()).isEqualTo(60L);
        assertThat(properties.getLifecycle().getLeaseTtlSeconds()).isEqualTo(90L);
        assertThat(properties.getLifecycle().getLeaseRenewIntervalSeconds()).isEqualTo(30L);
        assertThat(properties.getLifecycle().getForceRequestTtlSeconds()).isEqualTo(600L);
        assertThat(properties.getLifecycle().getShutdownTimeoutSeconds()).isEqualTo(30L);
    }
}
