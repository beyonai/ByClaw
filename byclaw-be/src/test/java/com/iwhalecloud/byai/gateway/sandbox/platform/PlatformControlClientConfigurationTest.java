package com.iwhalecloud.byai.gateway.sandbox.platform;

import static org.assertj.core.api.Assertions.assertThat;

import feign.Request;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;

class PlatformControlClientConfigurationTest {

    @Test
    void defaultTransportBudgetCoversMicrovmReadinessAndPreparation() {
        Request.Options options = options(new MockEnvironment());
        assertThat(options.readTimeoutMillis()).isEqualTo(240000);
        assertThat(options.connectTimeoutMillis()).isEqualTo(5000);
    }

    @Test
    void longerStartupBudgetIncreasesOnlyPlatformTransportDefault() {
        assertThat(options(new MockEnvironment().withProperty("BYCLAW_SANDBOX_STARTUP_TIMEOUT_MS", "300000"))
            .readTimeoutMillis()).isEqualTo(310000);
    }

    @Test
    void startupBudgetWithinMicrovmMinimumKeepsPreparationHeadroom() {
        assertThat(options(new MockEnvironment().withProperty("BYCLAW_SANDBOX_STARTUP_TIMEOUT_MS", "200000"))
            .readTimeoutMillis()).isEqualTo(240000);
    }

    @Test
    void explicitPlatformTransportSettingMayOverrideDefaultWithAShorterBudget() {
        assertThat(options(new MockEnvironment().withProperty("BYCLAW_SANDBOX_STARTUP_TIMEOUT_MS", "300000")
            .withProperty("byclaw.platform.read-timeout-ms", "90000"))
            .readTimeoutMillis()).isEqualTo(90000);
    }

    @Test
    void explicitWorkerBudgetAlsoGetsTransportHeadroom() {
        assertThat(options(new MockEnvironment().withProperty("BYCLAW_SANDBOX_STARTUP_TIMEOUT_MS", "60000")
            .withProperty("byclaw.gateway.worker-readiness-timeout-ms", "300000"))
            .readTimeoutMillis()).isEqualTo(310000);
    }

    @Test
    void explicitPlatformTransportSettingIsPreserved() {
        assertThat(options(new MockEnvironment().withProperty("BYCLAW_SANDBOX_STARTUP_TIMEOUT_MS", "200000")
            .withProperty("byclaw.platform.read-timeout-ms", "400000"))
            .readTimeoutMillis()).isEqualTo(400000);
    }

    private Request.Options options(MockEnvironment environment) {
        PlatformControlClient.Configuration configuration = new PlatformControlClient.Configuration();
        ReflectionTestUtils.setField(configuration, "env", environment);
        return configuration.platformAlertOptions();
    }
}
