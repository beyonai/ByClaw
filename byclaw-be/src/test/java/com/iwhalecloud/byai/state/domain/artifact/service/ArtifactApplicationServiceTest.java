package com.iwhalecloud.byai.state.domain.artifact.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.manager.mapper.artifact.ArtifactMapper;
import com.iwhalecloud.byai.state.domain.artifact.config.ArtifactProperties;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactContentUpdateDto;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDto;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactPublishMode;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactRecord;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactStatus;
import com.iwhalecloud.byai.state.domain.artifact.storage.ArtifactStoragePort;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
@DisabledOnOs(OS.WINDOWS)
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
        ReflectionTestUtils.setField(properties, "purgeRetentionSeconds", 2592000L);
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
        when(mapper.replaceContent(any(ArtifactRecord.class), anyLong(), anyString(), anyString(), any()))
            .thenReturn(1);
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
    void publishesSingleHtmlWithPublicUrlsAndManagementAccessKey() {
        MockMultipartFile file = new MockMultipartFile("file", "index.html", "text/plain",
            "<h1>preview</h1>".getBytes());

        ArtifactDto result = service.publish(file, ArtifactPublishMode.AUTO, null,
            true, null, null, null);
        String accessKey = result.getAccessKey();

        assertThat(result.getKind()).isEqualTo("FILE");
        assertThat(result.getPreviewUrl()).isEqualTo(
            "https://preview.test/byaiService/artifact-preview/" + result.getArtifactId() + "/");
        assertThat(result.getDownloadUrl()).isEqualTo(
            "https://preview.test/byaiService/artifact-download/" + result.getArtifactId());
        assertThat(accessKey).isNotBlank();
        assertThat(record.get().getStorageRoot()).isEqualTo("/sandbox-volume-root/byclaw-artifacts");
        assertThat(record.get().getAccessKeyHash()).hasSize(64).doesNotContain(accessKey);
        assertThat(result.getPurgeAt()).isAfter(result.getExpiresAt().plusDays(29));
        assertThat(service.resolvePreview(result.getArtifactId(), null)).isNotNull();
        assertThatCode(() -> service.requireManagementDataAccessible(result.getArtifactId(), accessKey))
            .doesNotThrowAnyException();
        assertThatThrownBy(() -> service.requireManagementDataAccessible(result.getArtifactId(), "wrong-key"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("Artifact不存在或管理访问密钥无效");
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

    @Test
    void replacesContentWithoutChangingIdentityAccessOrLifecycle() throws IOException {
        MockMultipartFile original = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>before</h1>".getBytes());
        ArtifactDto published = service.publish(original, ArtifactPublishMode.AUTO, null,
            true, null, "Original", null);
        String artifactId = published.getArtifactId();
        String accessKey = published.getAccessKey();
        String accessKeyHash = record.get().getAccessKeyHash();
        String previousOriginalKey = record.get().getOriginalKey();

        MockMultipartFile replacement = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>after</h1>".getBytes());
        ArtifactContentUpdateDto updated = service.replaceOwnedContent(artifactId, replacement, ArtifactPublishMode.AUTO,
            null, true, "Fixed", null);

        assertThat(updated.isOk()).isTrue();
        assertThat(updated.getOperation()).isEqualTo("updated");
        assertThat(updated.getStatus()).isEqualTo(ArtifactStatus.READY.name());
        assertThat(record.get().getArtifactId()).isEqualTo(artifactId);
        assertThat(record.get().getExpiresAt()).isEqualTo(published.getExpiresAt().toLocalDateTime());
        assertThat(record.get().getPurgeAt()).isEqualTo(published.getPurgeAt().toLocalDateTime());
        assertThat(record.get().getAccessKeyHash()).isEqualTo(accessKeyHash);
        assertThat(record.get().getOriginalKey()).isNotEqualTo(previousOriginalKey);
        assertThatCode(() -> service.requireManagementDataAccessible(artifactId, accessKey)).doesNotThrowAnyException();

        ArtifactApplicationService.ArtifactContent content = service.resolvePreview(artifactId, null);
        assertThat(new String(service.open(content).readAllBytes())).isEqualTo("<h1>after</h1>");
        assertThat(storage.objects).hasSize(1).doesNotContainKey(previousOriginalKey);
    }

    @Test
    void keepsCurrentContentWhenReplacementValidationFails() throws IOException {
        MockMultipartFile original = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>before</h1>".getBytes());
        ArtifactDto published = service.publish(original, ArtifactPublishMode.AUTO, null,
            true, null, null, null);
        String previousOriginalKey = record.get().getOriginalKey();
        MockMultipartFile replacement = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>broken</h1>".getBytes());

        assertThatThrownBy(() -> service.replaceOwnedContent(published.getArtifactId(), replacement,
            ArtifactPublishMode.AUTO, null, true, null, "deadbeef"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("SHA-256");

        ArtifactApplicationService.ArtifactContent content = service.resolvePreview(published.getArtifactId(), null);
        assertThat(new String(service.open(content).readAllBytes())).isEqualTo("<h1>before</h1>");
        assertThat(storage.objects).hasSize(1).containsKey(previousOriginalKey);
    }

    @Test
    void keepsCurrentContentWhenAnotherReplacementWinsThePointerSwap() throws IOException {
        MockMultipartFile original = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>before</h1>".getBytes());
        ArtifactDto published = service.publish(original, ArtifactPublishMode.AUTO, null,
            true, null, null, null);
        String previousOriginalKey = record.get().getOriginalKey();
        when(mapper.replaceContent(any(ArtifactRecord.class), anyLong(), anyString(), anyString(), any()))
            .thenReturn(0);
        MockMultipartFile replacement = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>after</h1>".getBytes());

        assertThatThrownBy(() -> service.replaceOwnedContent(published.getArtifactId(), replacement,
            ArtifactPublishMode.AUTO, null, true, null, null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("已被更新");

        ArtifactApplicationService.ArtifactContent content = service.resolvePreview(published.getArtifactId(), null);
        assertThat(new String(service.open(content).readAllBytes())).isEqualTo("<h1>before</h1>");
        assertThat(storage.objects).hasSize(1).containsKey(previousOriginalKey);
    }

    @Test
    void renewsExpiredPublicAccessBeforePhysicalDeletion() {
        MockMultipartFile file = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>preview</h1>".getBytes());
        ArtifactDto published = service.publish(file, ArtifactPublishMode.AUTO, null,
            true, null, null, null);
        record.get().setExpiresAt(LocalDateTime.now().minusMinutes(1));
        record.get().setPurgeAt(LocalDateTime.now().plusDays(5));
        when(mapper.renewExpiration(any(), any(), any(), any(), any())).thenReturn(1);

        assertThat(service.resolvePreview(published.getArtifactId(), null)).isNull();
        assertThatCode(() -> service.requireManagementDataAccessible(
            published.getArtifactId(), published.getAccessKey()))
            .doesNotThrowAnyException();

        ArtifactDto renewed = service.renewOwnedExpiration(published.getArtifactId(), 3600L);

        assertThat(renewed.getExpiresAt()).isAfter(OffsetDateTime.now());
        assertThat(renewed.getPurgeAt()).isAfter(renewed.getExpiresAt().plusDays(29));
        assertThat(service.resolvePreview(published.getArtifactId(), null)).isNotNull();
    }

    @Test
    void rejectsRenewalAfterPhysicalRetentionWindow() {
        MockMultipartFile file = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>preview</h1>".getBytes());
        ArtifactDto published = service.publish(file, ArtifactPublishMode.AUTO, null,
            true, null, null, null);
        record.get().setExpiresAt(LocalDateTime.now().minusDays(2));
        record.get().setPurgeAt(LocalDateTime.now().minusDays(1));

        assertThatThrownBy(() -> service.renewOwnedExpiration(published.getArtifactId(), 3600L))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void extendsPhysicalRetentionAfterOwnerAccess() {
        MockMultipartFile file = new MockMultipartFile("file", "index.html", "text/html",
            "<h1>preview</h1>".getBytes());
        ArtifactDto published = service.publish(file, ArtifactPublishMode.AUTO, null,
            true, null, null, null);
        LocalDateTime previousPurgeAt = LocalDateTime.now().plusDays(5);
        record.get().setPurgeAt(previousPurgeAt);
        when(mapper.renewPurgeAt(any(), any(), any())).thenReturn(1);

        ArtifactDto accessed = service.getOwned(published.getArtifactId());

        assertThat(accessed.getPurgeAt().toLocalDateTime()).isAfter(previousPurgeAt.plusDays(20));
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
