package com.iwhalecloud.byai.manager.connector;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class ConnectorStatusQueryTest {

    @Test
    void connectorListPreservesUnboundAndDisabledStates() throws Exception {
        String sql = read("byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/connector/ConnectorInfoMapper.xml");

        assertThat(sql).contains("when b.connector_id is null then null");
        assertThat(sql).contains("else 'n' end as enable_flag");
    }

    private String read(String relativePath) throws Exception {
        Path repoRoot = Path.of("").toAbsolutePath();
        while (repoRoot != null && !Files.exists(repoRoot.resolve("deploy/migrations/versions"))) {
            repoRoot = repoRoot.getParent();
        }
        assertThat(repoRoot).isNotNull();
        return Files.readString(repoRoot.resolve(relativePath))
            .toLowerCase(Locale.ROOT)
            .replaceAll("\\s+", " ");
    }
}
