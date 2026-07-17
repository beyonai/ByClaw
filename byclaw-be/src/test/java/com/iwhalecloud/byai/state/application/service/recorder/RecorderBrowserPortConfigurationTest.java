package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class RecorderBrowserPortConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
        .withUserConfiguration(
            RecorderBrowserProperties.class,
            BycliRecorderBrowserPort.class,
            ExternalRecorderVncProvider.class,
            PodmanRecorderVncProvider.class
        );

    private final ApplicationContextRunner savePropertiesContextRunner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(ConfigurationPropertiesAutoConfiguration.class))
        .withUserConfiguration(RecorderSaveProperties.class);

    @Test
    void saveAdapterPropertiesUseSafeDisabledDefaults() {
        savePropertiesContextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            RecorderSaveProperties properties = context.getBean(RecorderSaveProperties.class);
            assertThat(properties.isProductionEnabled()).isFalse();
            assertThat(properties.getInstance()).isEqualTo("bycli");
            assertThat(properties.getTimeoutMs()).isEqualTo(30_000);
        });
    }

    @Test
    void saveAdapterPropertiesExposeOnlyProductionAndInstanceOverrides() {
        savePropertiesContextRunner
            .withPropertyValues(
                "recorder.save-adapter.production-enabled=true",
                "recorder.save-adapter.instance=custom-bycli"
            )
            .run(context -> {
                assertThat(context).hasNotFailed();
                RecorderSaveProperties properties = context.getBean(RecorderSaveProperties.class);
                assertThat(properties.isProductionEnabled()).isTrue();
                assertThat(properties.getInstance()).isEqualTo("custom-bycli");
                assertThat(properties.getTimeoutMs()).isEqualTo(30_000);
            });
    }

    @Test
    void disabledSaveAdapterDoesNotRejectUnusedInvalidProductionSettings() {
        savePropertiesContextRunner
            .withPropertyValues(
                "recorder.save-adapter.production-enabled=false",
                "recorder.save-adapter.instance=../unsafe"
            )
            .run(context -> assertThat(context).hasNotFailed());
    }

    @Test
    void enabledSaveAdapterRejectsInvalidStartupSettings() {
        assertInvalidEnabledSetting("recorder.save-adapter.instance= ");
        assertInvalidEnabledSetting("recorder.save-adapter.instance=../unsafe");
    }

    private void assertInvalidEnabledSetting(String invalidSetting) {
        savePropertiesContextRunner
            .withPropertyValues(
                "recorder.save-adapter.production-enabled=true",
                invalidSetting
            )
            .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void defaultsToRealBycliAdapterWithoutMemoryFallback() {
        contextRunner.run(context -> {
            assertThat(context).hasSingleBean(RecorderBrowserPort.class);
            assertThat(context).hasSingleBean(BycliRecorderBrowserPort.class);
            assertThat(context).doesNotHaveBean(InMemoryRecorderBrowserPort.class);
        });
    }

    @Test
    void memoryAdapterPropertyDoesNotRegisterFakeRuntimeBean() {
        contextRunner
            .withPropertyValues("recorder.browser.adapter=memory")
            .run(context -> {
                assertThat(context).doesNotHaveBean(RecorderBrowserPort.class);
                assertThat(context).doesNotHaveBean(InMemoryRecorderBrowserPort.class);
            });
    }

    @Test
    void defaultsToExternalVncProviderWithoutPodmanDependency() {
        contextRunner.run(context -> {
            assertThat(context).hasSingleBean(RecorderVncProvider.class);
            assertThat(context).hasSingleBean(ExternalRecorderVncProvider.class);
            assertThat(context).doesNotHaveBean(PodmanRecorderVncProvider.class);
        });
    }

    @Test
    void managedVncProviderRegistersPodmanProviderOnlyWhenConfigured() {
        contextRunner
            .withPropertyValues("recorder.browser.vnc-provider=managed")
            .run(context -> {
                assertThat(context).hasSingleBean(RecorderVncProvider.class);
                assertThat(context).hasSingleBean(PodmanRecorderVncProvider.class);
                assertThat(context).doesNotHaveBean(ExternalRecorderVncProvider.class);
            });
    }
}
