package com.iwhalecloud.byai.state.domain.artifact.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.state.domain.artifact.config.ArtifactProperties;
import com.iwhalecloud.byai.state.domain.artifact.storage.ArtifactStoragePort;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

class ArtifactArchiveExtractorTest {

    private InMemoryArtifactStorage storage;
    private ArtifactArchiveExtractor extractor;

    @BeforeEach
    void setUp() {
        ArtifactProperties properties = new ArtifactProperties();
        ReflectionTestUtils.setField(properties, "maxUploadBytes", 1024L * 1024L);
        ReflectionTestUtils.setField(properties, "maxExpandedBytes", 1024L * 1024L);
        ReflectionTestUtils.setField(properties, "maxEntryBytes", 512L * 1024L);
        ReflectionTestUtils.setField(properties, "maxEntries", 100);
        ReflectionTestUtils.setField(properties, "maxDepth", 10);
        ReflectionTestUtils.setField(properties, "maxCompressionRatio", 100);
        storage = new InMemoryArtifactStorage();
        extractor = new ArtifactArchiveExtractor(properties, storage);
    }

    @Test
    void stripsSingleTopLevelDirectoryAndReportsRootAbsoluteReferences() throws Exception {
        MockMultipartFile zip = zip(Map.of(
            "site/index.html", "<script src=\"/assets/app.js\"></script>",
            "site/assets/app.js", "console.log('ok')"
        ));

        ArtifactArchiveExtractor.ExtractionResult result = extractor.extract(zip, true,
            "file", "/tmp/artifacts", "artifact/content");

        assertThat(result.paths()).containsExactlyInAnyOrder("index.html", "assets/app.js");
        assertThat(result.warnings()).singleElement().asString().contains("index.html");
        assertThat(storage.objects).containsKeys("artifact/content/index.html", "artifact/content/assets/app.js");
    }

    @Test
    void rejectsZipSlipBeforeWritingAnyObject() throws Exception {
        MockMultipartFile zip = zip(Map.of("../secret.txt", "secret"));

        assertThatThrownBy(() -> extractor.extract(zip, true,
            "file", "/tmp/artifacts", "artifact/content"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("路径穿越");
        assertThat(storage.objects).isEmpty();
    }

    @Test
    void rejectsSymbolicLinks() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipArchiveOutputStream zip = new ZipArchiveOutputStream(output)) {
            ZipArchiveEntry entry = new ZipArchiveEntry("site/link");
            entry.setUnixMode(0120777);
            zip.putArchiveEntry(entry);
            zip.write("target".getBytes(StandardCharsets.UTF_8));
            zip.closeArchiveEntry();
        }
        MockMultipartFile file = new MockMultipartFile("file", "site.zip", "application/zip", output.toByteArray());

        assertThatThrownBy(() -> extractor.extract(file, true,
            "file", "/tmp/artifacts", "artifact/content"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("符号链接");
    }

    private MockMultipartFile zip(Map<String, String> entries) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipArchiveOutputStream zip = new ZipArchiveOutputStream(output)) {
            for (Map.Entry<String, String> value : entries.entrySet()) {
                zip.putArchiveEntry(new ZipArchiveEntry(value.getKey()));
                zip.write(value.getValue().getBytes(StandardCharsets.UTF_8));
                zip.closeArchiveEntry();
            }
        }
        return new MockMultipartFile("file", "site.zip", "application/zip", output.toByteArray());
    }

    private static final class InMemoryArtifactStorage implements ArtifactStoragePort {

        private final Map<String, byte[]> objects = new HashMap<>();

        @Override
        public void initialize(String storageType, String storageRoot) {
        }

        @Override
        public void put(String storageType, String storageRoot, String objectKey, InputStream inputStream, long size,
            String contentType) {
            try {
                objects.put(objectKey, inputStream.readAllBytes());
            }
            catch (IOException e) {
                throw new IllegalStateException(e);
            }
        }

        @Override
        public InputStream open(String storageType, String storageRoot, String objectKey) {
            return new ByteArrayInputStream(objects.get(objectKey));
        }

        @Override
        public FileMetadata metadata(String storageType, String storageRoot, String objectKey) {
            FileMetadata metadata = new FileMetadata();
            metadata.setFileSize((long) objects.get(objectKey).length);
            return metadata;
        }

        @Override
        public boolean exists(String storageType, String storageRoot, String objectKey) {
            return objects.containsKey(objectKey);
        }

        @Override
        public void deletePrefix(String storageType, String storageRoot, String objectPrefix) {
            objects.keySet().removeIf(key -> key.startsWith(objectPrefix));
        }
    }
}
