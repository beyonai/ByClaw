package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;

class LarkSandboxCommandPolicyTest {

    private final LarkSandboxCommandPolicy policy = new LarkSandboxCommandPolicy();
    private final ManifestCommandCatalog catalog = commandCatalog();
    @TempDir Path temporary;

    @Test
    void preparesThePrivateHomeBeforeExecutingLark() throws Exception {
        Path by = Files.createDirectory(temporary.resolve("by"));
        Path cli = temporary.resolve("lark-cli");
        Files.writeString(cli, """
            #!/usr/bin/env python3
            import os, pathlib, stat
            home = pathlib.Path(os.environ['HOME'])
            print('prepared' if home.is_dir() and stat.S_IMODE(home.stat().st_mode) == 0o700 else 'missing')
            """);
        cli.toFile().setExecutable(true);
        var request = policy.build(catalog, LarkSandboxCommandPolicy.Action.SHOW_CONFIG);
        List<String> argv = new ArrayList<>();
        for (String argument : request.argv()) {
            argv.add(argument.equals("lark-cli") ? cli.toString()
                : argument.replace("'/by'", "'" + by + "'"));
        }
        ProcessBuilder builder = new ProcessBuilder(argv).redirectErrorStream(true);
        builder.environment().putAll(request.environment());
        builder.environment().put("HOME", by.resolve(".connector-auth/.lark-cli").toString());
        builder.environment().put("LARK_HOME", by.resolve(".connector-auth/.lark-cli").toString());
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        assertThat(process.waitFor()).isZero();
        assertThat(output.strip()).isEqualTo("prepared");
    }

    @Test
    void buildsFixedUserAuthorizationCommandAndEnvironment() {
        var request = policy.build(catalog, LarkSandboxCommandPolicy.Action.START_USER_AUTHORIZATION);

        assertThat(request.argv().subList(5, request.argv().size())).containsExactly(
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

        assertThat(request.argv().subList(5, request.argv().size())).containsExactly(
            "lark-cli", "auth", "login", "--device-code", "device-code-1", "--json");
        assertThat(request.background()).isTrue();
    }

    @ParameterizedTest
    @MethodSource("completionJsonModes")
    void detectsCompletionJsonModeUsingFlagOrderAndArgumentBoundaries(List<String> options, boolean expected) {
        assertThat(policy.completionUsesJson(completionCatalog(options), "device-code-1")).isEqualTo(expected);
    }

    private static Stream<Arguments> completionJsonModes() {
        return Stream.of(
            Arguments.of(List.of(), false),
            Arguments.of(List.of("--json"), true),
            Arguments.of(List.of("--json", "false"), true),
            Arguments.of(List.of("--json=false", "--json"), true),
            Arguments.of(List.of("--json", "--json=false"), false),
            Arguments.of(List.of("--", "--json"), false),
            Arguments.of(List.of("--json", "--", "--json=false"), true),
            Arguments.of(List.of("--profile", "--json"), false),
            Arguments.of(List.of("--scope", "--", "--json"), true)
        );
    }

    @ParameterizedTest
    @CsvSource({
        "1,true", "t,true", "T,true", "TRUE,true", "true,true", "True,true",
        "0,false", "f,false", "F,false", "FALSE,false", "false,false", "False,false"
    })
    void acceptsTheCliBooleanSpellings(String value, boolean expected) {
        assertThat(policy.completionUsesJson(completionCatalog(List.of("--json=" + value)), "device-code-1"))
            .isEqualTo(expected);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "yes", "no", "TrUe", "2"})
    void rejectsInvalidJsonBooleansEvenWhenALaterFlagWouldOverrideThem(String value) {
        assertThatThrownBy(() -> policy.completionUsesJson(
            completionCatalog(List.of("--json=" + value, "--json")), "device-code-1"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"--json", "--json=false", "--"})
    void doesNotInterpretTheDeviceCodeAsAnOutputFlag(String deviceCode) {
        assertThat(policy.completionUsesJson(completionCatalog(List.of()), deviceCode)).isFalse();
        assertThat(policy.completionUsesJson(completionCatalog(List.of("--json")), deviceCode)).isTrue();
    }

    @Test
    void appliesTheExistingCommandAndDeviceCodeValidationWhenDetectingOutputMode() {
        assertThatThrownBy(() -> policy.completionUsesJson(catalog, "device\ncode"))
            .isInstanceOf(IllegalArgumentException.class);
        ManifestCommandCatalog invalid = new ManifestCommandCatalog(
            Map.of("login", List.of(List.of("lark-cli", "auth", "login"),
                List.of("lark-cli", "auth", "status", "--device-code", "${deviceCode}"))),
            "invalid-completion", Map.of("deviceCode", ManifestCommandCatalog.PlaceholderPolicy.safeValue(512)));
        assertThatThrownBy(() -> policy.completionUsesJson(invalid, "device-code-1"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private ManifestCommandCatalog completionCatalog(List<String> options) {
        List<String> completion = new ArrayList<>(List.of(
            "lark-cli", "auth", "login", "--device-code", "${deviceCode}"));
        completion.addAll(options);
        return new ManifestCommandCatalog(
            Map.of("login", List.of(catalog.command("login", 0), completion)),
            "custom-completion", Map.of("deviceCode", ManifestCommandCatalog.PlaceholderPolicy.safeValue(512)));
    }

    @Test
    void initializesLocalApplicationUsingManifestDeviceFlow() {
        var request = policy.build(catalog, LarkSandboxCommandPolicy.Action.INITIALIZE_APP);

        assertThat(request.argv().subList(5, request.argv().size())).containsExactly("lark-cli", "config", "init", "--new", "--force-init");
        assertThat(request.environment()).containsEntry("HOME", "/by/.connector-auth/.lark-cli")
            .containsEntry("LARK_HOME", "/by/.connector-auth/.lark-cli");
        assertThat(request.background()).isTrue();
    }

    @Test
    void buildsFixedLogoutCommand() {
        var request = policy.build(catalog, LarkSandboxCommandPolicy.Action.LOGOUT);

        assertThat(request.argv().subList(5, request.argv().size())).containsExactly("lark-cli", "auth", "logout", "--json");
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
