package com.iwhalecloud.byai.manager.domain.connector.manifest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.entry;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ConnectorManifestCanonicalizerTest {

    private ConnectorManifestCanonicalizer canonicalizer;

    @BeforeEach
    void setUp() {
        canonicalizer = new ConnectorManifestCanonicalizer(new ObjectMapper());
    }

    @Test
    void canonicalizeIgnoresObjectOrderAndWhitespaceButPreservesCommandArrayOrder() {
        ConnectorInfo connector = connector("dingtalk");
        String first = """
            {
              "version":"1.0.52",
              "id":"dingtalk",
              "schemaVersion":"1.0",
              "runtime":{"commands":{"status":["dws","auth","status"]},"type":"cli"},
              "authStorage":{"nativePath":"/by/.connector-auth/.dws","mode":"native-home",
                "environment":{"HOME":"/by/.connector-auth/.dws"}},
              "skill":{"code":"dws","source":"system-builtin","installScope":"user","grantScope":"agent"}
            }
            """;
        String second = """
            {"schemaVersion":"1.0","id":"dingtalk","version":"1.0.52",
             "skill":{"grantScope":"agent","installScope":"user","source":"system-builtin","code":"dws"},
             "authStorage":{"environment":{"HOME":"/by/.connector-auth/.dws"},"mode":"native-home",
               "nativePath":"/by/.connector-auth/.dws"},
             "runtime":{"type":"cli","commands":{"status":["dws","auth","status"]}}}
            """;
        String reorderedCommand = second.replace(
            "[\"dws\",\"auth\",\"status\"]",
            "[\"auth\",\"dws\",\"status\"]");

        assertThat(canonicalizer.canonicalize(connector, first))
            .isEqualTo(canonicalizer.canonicalize(connector, second));
        assertThat(canonicalizer.canonicalize(connector, reorderedCommand))
            .isNotEqualTo(canonicalizer.canonicalize(connector, second));
    }

    @Test
    void canonicalizeRejectsConnectorIdMismatch() {
        assertThatThrownBy(() -> canonicalizer.canonicalize(connector("dingtalk"), manifest(
            "lark",
            "/by/.connector-auth/.dws",
            "{\"status\":[\"dws\",\"auth\",\"status\"]}")))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("id");
    }

    @Test
    void canonicalizeRejectsSkillCodeMismatch() {
        ConnectorInfo connector = connector("dingtalk");
        connector.setSkillCode("fws");

        assertThatThrownBy(() -> canonicalizer.canonicalize(connector, manifest(
            "dingtalk",
            "/by/.connector-auth/.dws",
            "{\"status\":[\"dws\",\"auth\",\"status\"]}")))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("skill.code");
    }

    @Test
    void canonicalizeRejectsCredentialPathOutsideConnectorAuthRoot() {
        assertThatThrownBy(() -> canonicalizer.canonicalize(connector("dingtalk"), manifest(
            "dingtalk",
            "/tmp/shared-home",
            "{\"status\":[\"dws\",\"auth\",\"status\"]}")))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("nativePath");
    }

    @Test
    void canonicalizeRejectsShellStringCommandsAndSensitiveFields() {
        assertThatThrownBy(() -> canonicalizer.canonicalize(connector("dingtalk"), manifest(
            "dingtalk",
            "/by/.connector-auth/.dws",
            "{\"status\":\"dws auth status\"}")))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("commands");

        String withSecret = manifest(
            "dingtalk",
            "/by/.connector-auth/.dws",
            "{\"status\":[\"dws\",\"auth\",\"status\"]}")
            .replace("\"skill\":", "\"appSecret\":\"secret-value\",\"skill\":");
        assertThatThrownBy(() -> canonicalizer.canonicalize(connector("dingtalk"), withSecret))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("sensitive");
    }

    @Test
    void canonicalizeAcceptsUserSandboxAuthorizationOwnership() {
        ConnectorInfo connector = connector("dingtalk");
        String manifest = manifest("dingtalk", "/by/.connector-auth/.dws",
            "{\"status\":[\"dws\",\"auth\",\"status\"]}")
            .replace("\"runtime\":{\"type\":\"cli\"",
                "\"runtime\":{\"authorizeIn\":\"user-sandbox\",\"type\":\"cli\"")
            .replace("\"authStorage\":{\"mode\":\"native-home\"",
                "\"authStorage\":{\"owner\":\"user-sandbox-auth-job\","
                    + "\"runtimeMutation\":\"sandbox-native\",\"mode\":\"native-home\"");

        assertThat(canonicalizer.canonicalize(connector, manifest))
            .contains("user-sandbox", "user-sandbox-auth-job", "sandbox-native");
    }

    @Test
    void canonicalizeRejectsOversizedManifest() {
        String oversized = manifest(
            "dingtalk",
            "/by/.connector-auth/.dws",
            "{\"status\":[\"dws\",\"auth\",\"status\"]}")
            .replace("\"version\":\"1.0.0\"", "\"version\":\"" + "x".repeat(66_000) + "\"");

        assertThatThrownBy(() -> canonicalizer.canonicalize(connector("dingtalk"), oversized))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("64 KiB");
    }

    @Test
    void extractEnvironmentReturnsValidatedCanonicalOrder() {
        ConnectorInfo connector = connector("dingtalk");
        String manifest = manifestWithEnvironment("""
            {
              "DWS_HOME":"/by/.connector-auth/.dws",
              "DWS_DISABLE_KEYCHAIN":"1",
              "DWS_CONFIG_DIR":"/by/.connector-auth/.dws/config"
            }
            """);

        assertThat(canonicalizer.extractEnvironment(connector, manifest))
            .containsExactly(
                entry("DWS_CONFIG_DIR", "/by/.connector-auth/.dws/config"),
                entry("DWS_DISABLE_KEYCHAIN", "1"),
                entry("DWS_HOME", "/by/.connector-auth/.dws"));
    }

    @Test
    void canonicalizeRejectsInvalidEnvironmentVariableNames() {
        assertThatThrownBy(() -> canonicalizer.canonicalize(
            connector("dingtalk"),
            manifestWithEnvironment("{\"lower-case\":\"value\"}")))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("environment key");

        assertThatThrownBy(() -> canonicalizer.canonicalize(
            connector("dingtalk"),
            manifestWithEnvironment("{\"1INVALID\":\"value\"}")))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("environment key");

        String oversizedKey = "A".repeat(129);
        assertThatThrownBy(() -> canonicalizer.canonicalize(
            connector("dingtalk"),
            manifestWithEnvironment("{\"" + oversizedKey + "\":\"value\"}")))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("environment key");
    }

    private ConnectorInfo connector(String connectorCode) {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorCode(connectorCode);
        return connector;
    }

    private String manifest(String id, String nativePath, String commands) {
        return """
            {
              "schemaVersion":"1.0",
              "id":"%s",
              "version":"1.0.0",
              "runtime":{"type":"cli","commands":%s},
              "authStorage":{"mode":"native-home","nativePath":"%s","environment":{"HOME":"%s"}},
              "skill":{"code":"dws","source":"system-builtin","installScope":"user","grantScope":"agent"}
            }
            """.formatted(id, commands, nativePath, nativePath);
    }

    private String manifestWithEnvironment(String environment) {
        return """
            {
              "schemaVersion":"1.0",
              "id":"dingtalk",
              "version":"1.0.52",
              "runtime":{"type":"cli","commands":{"status":["dws","auth","status"]}},
              "authStorage":{"mode":"native-home","nativePath":"/by/.connector-auth/.dws",
                "environment":%s},
              "skill":{"code":"dws","source":"system-builtin","installScope":"user","grantScope":"agent"}
            }
            """.formatted(environment);
    }
}
