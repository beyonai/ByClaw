package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;
import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;

@DisabledOnOs(OS.WINDOWS)
class ManifestCommandCatalogTest {

    @Test
    void resolvesCommandsAndFillsARegisteredWholeArgumentPlaceholder() {
        ConnectorInfo connector = connector();
        connector.setRuntimeManifest(manifest("""
            {
              "login":[
                ["lark-cli","auth","login","--domain","all","--no-wait","--json"],
                ["lark-cli","auth","login","--device-code","${deviceCode}","--json"]
              ]
            }
            """));

        ManifestCommandCatalog catalog = resolver().resolve(connector);

        assertThat(catalog.command("login", 0)).containsExactly(
            "lark-cli", "auth", "login", "--domain", "all", "--no-wait", "--json");
        assertThat(catalog.command("login", 1, Map.of("deviceCode", "device-123"))).containsExactly(
            "lark-cli", "auth", "login", "--device-code", "device-123", "--json");
        assertThat(catalog.digest()).hasSize(64);
    }

    @Test
    void resolvesOAuth2ManifestWithoutCliCommands() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorCode("github");
        connector.setSkillCode("github");
        connector.setRuntimeManifest("""
            {"schemaVersion":"1.0","id":"github","version":"1.0.0",
             "runtime":{"type":"oauth2","authorizeIn":"be-auth-job"},
             "authStorage":{"mode":"credential-reference","owner":"be-auth-job",
               "runtimeMutation":"provider-refresh-only","environment":{}},
             "skill":{"code":"github","source":"system-builtin","installScope":"user","grantScope":"agent"}}
            """);

        ManifestCommandCatalog catalog = resolver().resolve(connector);

        assertThat(catalog.digest()).hasSize(64);
        assertThatThrownBy(() -> catalog.size("login"))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("login");
    }

    @Test
    void rejectsMissingUnknownAndPartialPlaceholders() {
        ManifestCommandCatalog catalog = new ManifestCommandCatalog(
            Map.of("login", List.of(List.of("lark-cli", "${deviceCode}"))),
            "digest",
            Map.of("deviceCode", ManifestCommandCatalog.PlaceholderPolicy.safeValue(512))
        );

        assertThatThrownBy(() -> catalog.command("login", 0))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("deviceCode");
        assertThatThrownBy(() -> catalog.command("login", 0, Map.of("unknown", "value")))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("unknown");
        assertThatThrownBy(() -> catalog.command("login", 0, Map.of("deviceCode", "bad\nvalue")))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("deviceCode");

        ConnectorInfo connector = connector();
        connector.setRuntimeManifest(manifest("{\"login\":[[\"lark-cli\",\"prefix-${deviceCode}\"]]}"));
        assertThatThrownBy(() -> resolver().resolve(connector))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("placeholder");
    }

    @Test
    void returnsDefensiveCopiesAndRejectsMissingActionsAndIndexes() {
        ManifestCommandCatalog catalog = new ManifestCommandCatalog(
            Map.of("status", List.of(List.of("dws", "auth", "status"))),
            "digest",
            Map.of()
        );

        assertThatThrownBy(() -> catalog.command("login", 0))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("login");
        assertThatThrownBy(() -> catalog.command("status", 1))
            .isInstanceOf(InvalidConnectorManifestException.class)
            .hasMessageContaining("status[1]");
        assertThatThrownBy(() -> catalog.command("status", 0).add("mutate"))
            .isInstanceOf(UnsupportedOperationException.class);
    }

    private ConnectorManifestCommandResolver resolver() {
        ObjectMapper objectMapper = new ObjectMapper();
        return new ConnectorManifestCommandResolver(
            objectMapper,
            new ConnectorManifestCanonicalizer(objectMapper),
            Map.of("deviceCode", ManifestCommandCatalog.PlaceholderPolicy.safeValue(512))
        );
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorCode("lark");
        connector.setSkillCode("fws");
        return connector;
    }

    private String manifest(String commands) {
        return """
            {
              "schemaVersion":"1.0",
              "id":"lark",
              "version":"1.0.84",
              "runtime":{"type":"cli","commands":%s},
              "authStorage":{"mode":"native-home","nativePath":"/by/.connector-auth/.lark-cli",
                "environment":{"LARK_HOME":"/by/.connector-auth/.lark-cli"}},
              "skill":{"code":"fws","source":"system-builtin","installScope":"user","grantScope":"agent"}
            }
            """.formatted(commands);
    }
}
