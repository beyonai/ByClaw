package com.iwhalecloud.byai.state.domain.artifact.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.manager.mapper.artifact.ArtifactMapper;
import com.iwhalecloud.byai.state.domain.artifact.config.ArtifactProperties;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDto;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactPublishMode;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactRecord;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactStatus;
import com.iwhalecloud.byai.state.domain.artifact.storage.ArtifactStoragePort;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

class ArtifactApplicationServiceTest {

    private ArtifactMapper mapper;
    private InMemoryStorage storage;
    private ArtifactCleanupService cleanupService;
    private ArtifactApplicationService service;
    private ArtifactProperties properties;
    private AtomicReference<ArtifactRecord> record;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(42L);
        loginInfo.setUserCode("user-42");
        CurrentUserHolder.setLoginInfo(loginInfo);

        properties = new ArtifactProperties();
        ReflectionTestUtils.setField(properties, "storageType", "file");
        ReflectionTestUtils.setField(properties, "sandboxFileVolumeRoot", "/sandbox-volume-root");
        ReflectionTestUtils.setField(properties, "bucket", "artifact-bucket");
        ReflectionTestUtils.setField(properties, "publicBaseUrl", "https://preview.test/byaiService");
        ReflectionTestUtils.setField(properties, "previewPathPrefix", "/artifact-preview");
        ReflectionTestUtils.setField(properties, "downloadPathPrefix", "/artifact-download");
        ReflectionTestUtils.setField(properties, "defaultExpiresSeconds", 604800L);
        ReflectionTestUtils.setField(properties, "maxExpiresSeconds", 2592000L);
        ReflectionTestUtils.setField(properties, "maxUploadBytes", 1024L * 1024L);

        mapper = mock(ArtifactMapper.class);
        record = new AtomicReference<>();
        doAnswer(invocation -> {
            record.set(invocation.getArgument(0));
            return 1;
        }).when(mapper).insert(any(ArtifactRecord.class));
        doAnswer(invocation -> {
            record.set(invocation.getArgument(0));
            return 1;
        }).when(mapper).updateById(any(ArtifactRecord.class));
        when(mapper.selectById(any())).thenAnswer(invocation -> record.get());
        storage = new InMemoryStorage();
        cleanupService = mock(ArtifactCleanupService.class);
        ArtifactArchiveExtractor extractor = mock(ArtifactArchiveExtractor.class);
        service = new ArtifactApplicationService(mapper, storage, extractor, properties, cleanupService);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void publishesSingleHtmlAndResolvesItsCapabilityUrl() {
        MockMultipartFile file = new MockMultipartFile("file", "index.html", "text/plain",
            "<h1>preview</h1>".getBytes());

        ArtifactDto result = service.publish(file, ArtifactPublishMode.AUTO, null,
            true, null, null, null);
        String accessKey = result.getPreviewUrl().split("/")[6];

        assertThat(result.getKind()).isEqualTo("FILE");
        assertThat(result.getPreviewUrl()).startsWith("https://preview.test/byaiService/artifact-preview/");
        assertThat(result.getDownloadUrl()).startsWith("https://preview.test/byaiService/artifact-download/");
        assertThat(record.get().getStorageRoot()).isEqualTo("/sandbox-volume-root/byclaw-artifacts");
        assertThat(record.get().getAccessKeyHash()).hasSize(64).doesNotContain(accessKey);
        assertThat(service.resolvePreview(result.getArtifactId(), accessKey, null)).isNotNull();
        assertThat(service.resolvePreview(result.getArtifactId(), "wrong-key", null)).isNull();
    }

    @Test
    void usesBucketInsteadOfFilesystemRootForObjectStorage() {
        ReflectionTestUtils.setField(properties, "storageType", "aliyun-oss");
        MockMultipartFile file = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>preview</h1>".getBytes());

        service.publish(file, ArtifactPublishMode.AUTO, null, true, null, null, null);

        assertThat(record.get().getStorageType()).isEqualTo("aliyun-oss");
        assertThat(record.get().getStorageRoot()).isEqualTo("artifact-bucket");
    }

    @Test
    void rejectsMismatchedChecksumAndCleansPartialStorage() {
        MockMultipartFile file = new MockMultipartFile("file", "report.txt", "text/plain", "report".getBytes());

        assertThatThrownBy(() -> service.publish(file, ArtifactPublishMode.AUTO, null,
            true, null, null, "deadbeef"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("SHA-256");

        assertThat(record.get().getStatus()).isEqualTo(ArtifactStatus.FAILED.name());
        verify(cleanupService).cleanStorage(record.get());
    }

    private static final class InMemoryStorage implements ArtifactStoragePort {

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
