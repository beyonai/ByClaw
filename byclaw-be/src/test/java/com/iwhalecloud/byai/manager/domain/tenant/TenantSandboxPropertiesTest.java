package com.iwhalecloud.byai.manager.domain.tenant;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.ResourcePropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/** A bad deployment profile must fail before any tenant reservation can be accepted. */
class TenantSandboxPropertiesTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withUserConfiguration(ProfileConfiguration.class)
        .withInitializer(context -> {
            // Deployment assertions must not inherit a developer machine's active profile setting.
            context.getEnvironment().getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
            context.getEnvironment().getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        });

    @Test
    void missingConfigurationDefaultsToMediumAndSupportedProfilesBind() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(TenantSandboxProperties.class).getProfileKey()).isEqualTo("m");
        });
        for (String profile : new String[]{"s", "m", "l"}) {
            runner.withPropertyValues("byclaw.tenant.sandbox.profile-key=" + profile).run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context.getBean(TenantSandboxProperties.class).getProfileKey()).isEqualTo(profile);
            });
        }
    }

    @Test
    void blankAndUnsupportedProfilesFailStartup() {
        for (String profile : new String[]{"", " ", "M", "xl"}) {
            runner.withPropertyValues("byclaw.tenant.sandbox.profile-key=" + profile).run(context ->
                assertThat(context).hasFailed());
        }
    }

    @Test
    void developmentAndDeploymentFilesBindTheSharedEnvironmentVariable() throws Exception {
        Path root = Files.isDirectory(Path.of("deploy")) ? Path.of(".") : Path.of("..");
        for (String relative : new String[]{"byclaw-be/config/application.properties", "deploy/config/application.properties"}) {
            var properties = new ResourcePropertySource(new FileSystemResource(root.resolve(relative)));
            for (String profile : new String[]{"s", "m", "l", ""}) {
                runner.withInitializer(context -> {
                    var sources = context.getEnvironment().getPropertySources();
                    sources.addLast(properties);
                    sources.addFirst(new SystemEnvironmentPropertySource("tenant-profile-env",
                        Map.of("TENANT_SANDBOX_PROFILE_KEY", profile)));
                }).run(context -> {
                    if (profile.isEmpty()) {
                        assertThat(context).hasFailed();
                    } else {
                        assertThat(context).hasNotFailed();
                        assertThat(context.getBean(TenantSandboxProperties.class).getProfileKey()).isEqualTo(profile);
                    }
                });
            }
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(TenantSandboxProperties.class)
    static class ProfileConfiguration { }
}
