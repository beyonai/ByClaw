package com.iwhalecloud.byai.manager.domain.connector.provider.dingtalk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;

class DwsAuthorizationCommandPolicyTest {

    @Test
    void acceptsExpectedDwsAuthSubcommand() {
        ManifestCommandCatalog catalog = catalog(List.of("dws", "auth", "status", "--format", "json"));

        assertThat(DwsAuthorizationCommandPolicy.command(catalog, "status", 0, "status"))
            .containsExactly("dws", "auth", "status", "--format", "json");
    }

    @Test
    void rejectsUnexpectedExecutableBeforeLegacyRouteCanLaunchIt() {
        ManifestCommandCatalog catalog = catalog(List.of("sh", "-c", "status"));

        assertThatThrownBy(() -> DwsAuthorizationCommandPolicy.command(catalog, "status", 0, "status"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("DWS manifest command is not allowed");
    }

    private ManifestCommandCatalog catalog(List<String> command) {
        return new ManifestCommandCatalog(Map.of("status", List.of(command)), "digest", Map.of());
    }
}
