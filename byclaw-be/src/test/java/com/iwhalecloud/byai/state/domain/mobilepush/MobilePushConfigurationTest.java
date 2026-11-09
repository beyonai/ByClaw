package com.iwhalecloud.byai.state.domain.mobilepush;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.PropertiesPropertySource;
import org.springframework.core.env.StandardEnvironment;

/** 本地启动与容器部署必须使用相同的变量契约，无须额外加载示例 YAML。 */
class MobilePushConfigurationTest {
    @Test
    void localAndDeploymentConfigurationsResolvePrivateEnvironmentValues() throws Exception {
        for (String configuration : new String[] {"config/application.properties",
            "../deploy/config/application.properties"}) {
            StandardEnvironment environment = environment(configuration);
            environment.getPropertySources().addFirst(new MapPropertySource("push-test", Map.of(
                "MOBILE_PUSH_ENABLED", "true", "MOBILE_PUSH_SDK_APP_ID", "123",
                "MOBILE_PUSH_CLIENT_APP_KEY", "test-client-key",
                "MOBILE_PUSH_SERVER_SECRET_KEY", "test-server-key",
                "MOBILE_PUSH_ADMINISTRATOR", "test-admin",
                "MOBILE_PUSH_ENVIRONMENT", "development")));

            MobilePushProperties properties = Binder.get(environment)
                .bind("byclaw.mobile-push", MobilePushProperties.class).get();
            assertThat(properties.ready()).isTrue();
            assertThat(properties.getSdkAppId()).isEqualTo(123);
            assertThat(properties.getClientAppKey()).isEqualTo("test-client-key");
            assertThat(properties.getSecretKey()).isEqualTo("test-server-key");
            assertThat(properties.getAdministrator()).isEqualTo("test-admin");
            assertThat(properties.getEnvironmentId()).isEqualTo("development");
            assertThat(properties.getApnsInfo()).containsEntry("Sound", "default");
        }
    }

    @Test
    void missingDeploymentValuesLeavePushDisabledWithoutEmbeddedCredentials() throws Exception {
        StandardEnvironment environment = environment("config/application.properties");
        MobilePushProperties properties = Binder.get(environment)
            .bind("byclaw.mobile-push", MobilePushProperties.class).get();
        assertThat(properties.ready()).isFalse();
        assertThat(properties.getSdkAppId()).isZero();
        assertThat(properties.getClientAppKey()).isEmpty();
        assertThat(properties.getSecretKey()).isEmpty();
    }

    private StandardEnvironment environment(String configuration) throws Exception {
        Properties values = new Properties();
        try (InputStream input = Files.newInputStream(Path.of(configuration))) {
            values.load(input);
        }
        StandardEnvironment environment = new StandardEnvironment();
        // 隔离开发机已有环境变量，避免测试误用本机真实密钥或已开启的服务。
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addLast(new PropertiesPropertySource("configuration", values));
        return environment;
    }
}
