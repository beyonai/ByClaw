package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipInputStream;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TenantNodeSchemaServiceTest {

    @Test
    void loadsBundledBaselineWhenNoExternalPathIsConfigured() throws Exception {
        byte[] bundle = service("").readBundle();
        try (ZipInputStream zip = new ZipInputStream(new java.io.ByteArrayInputStream(bundle))) {
            String sqlPath = zip.getNextEntry().getName();
            assertTrue(sqlPath.matches("baseline/V[0-9]+(\\.[0-9]+)*/__ddl\\.sql"));
            assertEquals(sqlPath.replace("__ddl.sql", "manifest.json"), zip.getNextEntry().getName());
        }
    }

    @Test
    void selectsNewestVersionNumerically() {
        assertTrue(TenantNodeSchemaService.compareVersions("V0.10.0", "V0.9.0") > 0);
        assertTrue(TenantNodeSchemaService.compareVersions("V1.0", "V0.99.99") > 0);
    }

    @Test
    void externalBundleOverridesBundledBaseline(@TempDir Path directory) throws Exception {
        byte[] content = "override".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Path bundle = directory.resolve("baseline.zip");
        Files.write(bundle, content);
        assertArrayEquals(content, service(bundle.toString()).readBundle());
    }

    @Test
    void rejectsMissingConfiguredBundle(@TempDir Path directory) {
        assertThrows(IllegalStateException.class,
            () -> service(directory.resolve("missing.zip").toString()).readBundle());
    }

    private TenantNodeSchemaService service(String bundlePath) {
        return new TenantNodeSchemaService(null, new ObjectMapper(), bundlePath, "http://opensandbox:9005", "", "token");
    }
}
