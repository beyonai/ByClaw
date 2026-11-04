package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;

class LarkSandboxCommandPolicyTest {

    private final LarkSandboxCommandPolicy policy = new LarkSandboxCommandPolicy();
    private final ManifestCommandCatalog catalog = commandCatalog();

    @Test
    void buildsFixedUserAuthorizationCommandAndEnvironment() {
        var request = policy.build(catalog, LarkSandboxCommandPolicy.Action.START_USER_AUTHORIZATION);

        assertThat(request.argv()).containsExactly(
            "lark-cli", "auth", "login", "--domain", "all", "--no-wait", "--json");
        assertThat(request.environment()).containsEntry("HOME", "/by/.connector-auth/.lark-cli")
            .containsEntry("LARK_HOME", "/by/.connector-auth/.lark-cli");
        assertThat(request.background()).isFalse();
    }

    @Test
    void acceptsDeviceCodeOnlyForCompletionAction() {
        var request = policy.build(catalog,
            LarkSandboxCommandPolicy.Action.COMPLETE_USER_AUTHORIZATION,
            "device-code-1",
            Duration.ofMinutes(1),
            1024);

        assertThat(request.argv()).containsExactly(
            "lark-cli", "auth", "login", "--device-code", "device-code-1", "--json");
        assertThat(request.background()).isTrue();
    }

    @Test
    void initializesLocalApplicationUsingManifestDeviceFlow() {
        var request = policy.build(catalog, LarkSandboxCommandPolicy.Action.INITIALIZE_APP);

        assertThat(request.argv()).containsExactly("lark-cli", "config", "init", "--new", "--force-init");
        assertThat(request.environment()).containsEntry("HOME", "/by/.connector-auth/.lark-cli")
            .containsEntry("LARK_HOME", "/by/.connector-auth/.lark-cli");
        assertThat(request.background()).isTrue();
    }

    @Test
    void buildsFixedLogoutCommand() {
        var request = policy.build(catalog, LarkSandboxCommandPolicy.Action.LOGOUT);

        assertThat(request.argv()).containsExactly("lark-cli", "auth", "logout", "--json");
        assertThat(request.environment()).containsEntry("HOME", "/by/.connector-auth/.lark-cli")
            .containsEntry("LARK_HOME", "/by/.connector-auth/.lark-cli");
        assertThat(request.background()).isFalse();
    }

    @Test
    void rejectsControlCharactersAndMissingDeviceCode() {
        assertThatThrownBy(() -> policy.build(catalog,
            LarkSandboxCommandPolicy.Action.COMPLETE_USER_AUTHORIZATION,
            "device\ncode", Duration.ofMinutes(1), 1024))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.build(catalog,
            LarkSandboxCommandPolicy.Action.COMPLETE_USER_AUTHORIZATION,
            null, Duration.ofMinutes(1), 1024))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private ManifestCommandCatalog commandCatalog() {
        return new ManifestCommandCatalog(
            Map.of(
                "configCheck", List.of(List.of("lark-cli", "config", "show")),
                "configInitialize", List.of(List.of("lark-cli", "config", "init", "--new", "--force-init")),
                "login", List.of(
                    List.of("lark-cli", "auth", "login", "--domain", "all", "--no-wait", "--json"),
                    List.of("lark-cli", "auth", "login", "--device-code", "${deviceCode}", "--json")),
                "status", List.of(List.of("lark-cli", "auth", "status", "--json", "--verify")),
                "logout", List.of(List.of("lark-cli", "auth", "logout", "--json"))
            ),
            "test-digest",
            Map.of("deviceCode", ManifestCommandCatalog.PlaceholderPolicy.safeValue(512))
        );
    }
}
