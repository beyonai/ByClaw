package com.iwhalecloud.byai.manager.domain.connector.manifest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
}
