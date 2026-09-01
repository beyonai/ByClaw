package com.iwhalecloud.byai.state.domain.artifact.service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.manager.mapper.artifact.ArtifactMapper;
import com.iwhalecloud.byai.state.domain.artifact.config.ArtifactProperties;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDto;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactKind;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactPublishMode;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactRecord;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactStatus;
import com.iwhalecloud.byai.state.domain.artifact.storage.ArtifactStoragePort;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * Orchestrates authenticated publication, capability access, and owner lifecycle operations.
 */
@Service
public class ArtifactApplicationService {

    private static final DateTimeFormatter STORAGE_DATE = DateTimeFormatter.ofPattern("yyyy/MM/dd");
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final ArtifactMapper artifactMapper;
    private final ArtifactStoragePort storage;
    private final ArtifactArchiveExtractor archiveExtractor;
    private final ArtifactProperties properties;
    private final ArtifactCleanupService cleanupService;

    public ArtifactApplicationService(ArtifactMapper artifactMapper, ArtifactStoragePort storage,
        ArtifactArchiveExtractor archiveExtractor, ArtifactProperties properties, ArtifactCleanupService cleanupService) {
        this.artifactMapper = artifactMapper;
        this.storage = storage;
        this.archiveExtractor = archiveExtractor;
        this.properties = properties;
        this.cleanupService = cleanupService;
    }

    public ArtifactDto publish(MultipartFile file, ArtifactPublishMode publishMode, String entryPoint,
        boolean stripTopLevelDirectory, Long expiresInSeconds, String displayName, String expectedSha256) {
        validateUpload(file);
        ArtifactPublishMode mode = publishMode == null ? ArtifactPublishMode.AUTO : publishMode;
        long ttlSeconds = validateExpiry(expiresInSeconds);
        String originalName = safeOriginalName(file.getOriginalFilename());
        String artifactId = UUID.randomUUID().toString();
        String accessKey = generateManagementAccessKey();
        String storageType = StringUtils.defaultIfBlank(properties.getStorageType(), StorageType.FILE);
        String storageRoot = StorageType.isLocalFilesystem(storageType)
            ? properties.getLocalRoot() : properties.getBucket();
        String storagePrefix = "artifacts/" + LocalDate.now().format(STORAGE_DATE) + "/" + artifactId;
        String originalKey = storagePrefix + "/original/" + storageFileName(originalName);
        String contentPrefix = storagePrefix + "/content";
        LocalDateTime now = LocalDateTime.now();

        ArtifactRecord record = new ArtifactRecord();
        record.setArtifactId(artifactId);
        record.setOwnerUserId(CurrentUserHolder.getCurrentUserId());
        record.setOwnerUserCode(CurrentUserHolder.getCurrentUserCode());
        record.setStatus(ArtifactStatus.UPLOADING.name());
        record.setStorageType(storageType);
        record.setStorageRoot(storageRoot);
        record.setStoragePrefix(storagePrefix);
        record.setOriginalKey(originalKey);
        record.setContentPrefix(contentPrefix);
        record.setOriginalName(originalName);
        record.setDisplayName(StringUtils.defaultIfBlank(displayName, originalName));
        record.setFileSize(file.getSize());
        LocalDateTime expiresAt = now.plusSeconds(ttlSeconds);
        record.setExpiresAt(expiresAt);
        record.setPurgeAt(expiresAt.plusSeconds(validatedPurgeRetentionSeconds()));
        record.setCreateTime(now);
        record.setUpdateTime(now);
        record.setAccessKeyHash(sha256Hex(accessKey.getBytes(StandardCharsets.UTF_8)));
        artifactMapper.insert(record);

        try {
            storage.initialize(storageType, storageRoot);
            String calculatedSha256 = calculateSha256(file);
            if (StringUtils.isNotBlank(expectedSha256)
                && !calculatedSha256.equalsIgnoreCase(expectedSha256.trim())) {
                throw new IllegalArgumentException("上传文件SHA-256校验失败");
            }
            record.setSha256(calculatedSha256);
            record.setContentType(ArtifactMediaTypeResolver.resolve(originalName, readPrefix(file, 512)));
            try (InputStream input = file.getInputStream()) {
                storage.put(storageType, storageRoot, originalKey, input, file.getSize(), record.getContentType());
            }

            Publication publication = publishContent(record, file, mode, entryPoint, stripTopLevelDirectory);
            record.setKind(publication.kind().name());
            record.setEntryPoint(publication.entryPoint());
            record.setExpandedSize(publication.expandedSize());
            record.setWarningsJson(JSON.toJSONString(publication.warnings()));
            record.setStatus(ArtifactStatus.READY.name());
            record.setUpdateTime(LocalDateTime.now());
            artifactMapper.updateById(record);
            return toDto(record, accessKey, publication.warnings());
        }
        catch (Exception e) {
            record.setStatus(ArtifactStatus.FAILED.name());
            record.setUpdateTime(LocalDateTime.now());
            artifactMapper.updateById(record);
            cleanupService.cleanStorage(record);
            if (e instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new IllegalStateException("Artifact发布失败", e);
        }
    }

    public ArtifactDto getOwned(String artifactId) {
        ArtifactRecord record = requireOwned(artifactId);
        renewPurgeAfterAccess(record);
        return toDto(record, null, parseWarnings(record.getWarningsJson()));
    }

    /**
     * Restores or extends public access while the Artifact is still inside its physical retention window.
     */
    public ArtifactDto renewOwnedExpiration(String artifactId, Long expiresInSeconds) {
        long ttlSeconds = validateExpiry(expiresInSeconds);
        ArtifactRecord record = requireOwned(artifactId);
        LocalDateTime now = LocalDateTime.now();
        if (!ArtifactStatus.READY.name().equals(record.getStatus())
            || record.getPurgeAt() == null || !record.getPurgeAt().isAfter(now)) {
            throw new IllegalArgumentException("Artifact已超过物理保留期限或进入删除流程，无法续约");
        }

        LocalDateTime expiresAt = now.plusSeconds(ttlSeconds);
        LocalDateTime purgeAt = latest(record.getPurgeAt(),
            expiresAt.plusSeconds(validatedPurgeRetentionSeconds()), expiresAt);
        int updated = artifactMapper.renewExpiration(
            artifactId, record.getOwnerUserId(), expiresAt, purgeAt, now);
        if (updated != 1) {
            throw new IllegalArgumentException("Artifact已超过物理保留期限或进入删除流程，无法续约");
        }
        record.setExpiresAt(expiresAt);
        record.setPurgeAt(purgeAt);
        record.setUpdateTime(now);
        return toDto(record, null, parseWarnings(record.getWarningsJson()));
    }

    public void deleteOwned(String artifactId) {
        ArtifactRecord record = requireOwned(artifactId);
        if (ArtifactStatus.DELETED.name().equals(record.getStatus())) {
            return;
        }
        record.setStatus(ArtifactStatus.DELETING.name());
        record.setUpdateTime(LocalDateTime.now());
        artifactMapper.updateById(record);
        cleanupService.deleteAsync(record.getArtifactId());
    }

    public void requirePublicDataAccessible(String artifactId) {
        ArtifactRecord record = resolvePublicAccess(artifactId);
        if (record == null) {
            throw new IllegalArgumentException("Artifact不存在或已过期");
        }
        requireRetainedHtmlDataAccessible(record);
    }

    /**
     * Verifies the management key before allowing an unscoped read of retained Artifact data.
     */
    public void requireManagementDataAccessible(String artifactId, String accessKey) {
        if (StringUtils.isAnyBlank(artifactId, accessKey)) {
            throw new IllegalArgumentException("Artifact不存在或管理访问密钥无效");
        }
        ArtifactRecord record = artifactMapper.selectById(artifactId);
        if (record == null || StringUtils.isBlank(record.getAccessKeyHash())) {
            throw new IllegalArgumentException("Artifact不存在或管理访问密钥无效");
        }
        byte[] actual = sha256Hex(accessKey.getBytes(StandardCharsets.UTF_8)).getBytes(StandardCharsets.US_ASCII);
        byte[] expected = record.getAccessKeyHash().getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(actual, expected)) {
            throw new IllegalArgumentException("Artifact不存在或管理访问密钥无效");
        }
        requireRetainedHtmlDataAccessible(record);
        renewPurgeAfterAccess(record);
    }

    public ArtifactContent resolvePreview(String artifactId, String requestedPath) {
        ArtifactRecord record = resolvePublicAccess(artifactId);
        if (record == null || ArtifactKind.DOWNLOAD_ONLY.name().equals(record.getKind())) {
            return null;
        }
        String objectKey;
        String fileName;
        if (ArtifactKind.SITE.name().equals(record.getKind())) {
            String resourcePath = normalizeRequestedPath(requestedPath);
            if (resourcePath.isBlank()) {
                resourcePath = record.getEntryPoint();
            }
            objectKey = join(record.getContentPrefix(), resourcePath);
            fileName = resourcePath;
        }
        else {
            if (StringUtils.isNotBlank(normalizeRequestedPath(requestedPath))) {
                return null;
            }
            objectKey = record.getOriginalKey();
            fileName = record.getOriginalName();
        }
        if (!storage.exists(record.getStorageType(), record.getStorageRoot(), objectKey)) {
            return null;
        }
        FileMetadata metadata = storage.metadata(record.getStorageType(), record.getStorageRoot(), objectKey);
        return new ArtifactContent(record, objectKey, fileName, metadata);
    }

    public ArtifactContent resolveDownload(String artifactId) {
        ArtifactRecord record = resolvePublicAccess(artifactId);
        if (record == null
            || !storage.exists(record.getStorageType(), record.getStorageRoot(), record.getOriginalKey())) {
            return null;
        }
        FileMetadata metadata = storage.metadata(record.getStorageType(), record.getStorageRoot(), record.getOriginalKey());
        return new ArtifactContent(record, record.getOriginalKey(), record.getOriginalName(), metadata);
    }

    public InputStream open(ArtifactContent content) {
        ArtifactRecord record = content.record();
        return storage.open(record.getStorageType(), record.getStorageRoot(), content.objectKey());
    }

    public InputStream open(ArtifactContent content, long offset, long length) {
        ArtifactRecord record = content.record();
        return storage.open(record.getStorageType(), record.getStorageRoot(), content.objectKey(), offset, length);
    }

    private Publication publishContent(ArtifactRecord record, MultipartFile file, ArtifactPublishMode mode,
        String requestedEntryPoint, boolean stripTopLevelDirectory) throws IOException {
        boolean zip = isZip(file, record.getOriginalName());
        if (!zip) {
            if (mode == ArtifactPublishMode.SITE && !ArtifactMediaTypeResolver.isHtml(record.getOriginalName())) {
                throw new IllegalArgumentException("SITE模式只支持ZIP站点或单个HTML文件");
            }
            ArtifactKind kind = mode == ArtifactPublishMode.DOWNLOAD_ONLY
                ? ArtifactKind.DOWNLOAD_ONLY : ArtifactKind.FILE;
            return new Publication(kind, null, 0L, List.of());
        }
        if (mode == ArtifactPublishMode.DOWNLOAD_ONLY || mode == ArtifactPublishMode.FILE) {
            ArtifactKind kind = mode == ArtifactPublishMode.FILE ? ArtifactKind.FILE : ArtifactKind.DOWNLOAD_ONLY;
            return new Publication(kind, null, 0L, List.of());
        }

        ArtifactArchiveExtractor.ExtractionResult extraction = archiveExtractor.extract(file,
            stripTopLevelDirectory, record.getStorageType(), record.getStorageRoot(), record.getContentPrefix());
        String normalizedEntryPoint = normalizeEntryPoint(requestedEntryPoint);
        boolean entryExists = extraction.paths().contains(normalizedEntryPoint);
        if (!entryExists && mode == ArtifactPublishMode.SITE) {
            throw new IllegalArgumentException("ZIP中不存在站点入口: " + normalizedEntryPoint);
        }
        if (!entryExists) {
            return new Publication(ArtifactKind.DOWNLOAD_ONLY, null, extraction.expandedSize(), extraction.warnings());
        }
        return new Publication(ArtifactKind.SITE, normalizedEntryPoint, extraction.expandedSize(), extraction.warnings());
    }

    private ArtifactRecord resolvePublicAccess(String artifactId) {
        if (StringUtils.isBlank(artifactId)) {
            return null;
        }
        ArtifactRecord record = artifactMapper.selectById(artifactId);
        if (record == null || !ArtifactStatus.READY.name().equals(record.getStatus())
            || record.getExpiresAt() == null || !record.getExpiresAt().isAfter(LocalDateTime.now())
            || record.getPurgeAt() == null || !record.getPurgeAt().isAfter(LocalDateTime.now())) {
            return null;
        }
        renewPurgeAfterAccess(record);
        return record;
    }

    private ArtifactRecord requireOwned(String artifactId) {
        ArtifactRecord record = artifactMapper.selectById(artifactId);
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (record == null || currentUserId == null || !currentUserId.equals(record.getOwnerUserId())) {
            throw new IllegalArgumentException("Artifact不存在");
        }
        return record;
    }

    private void requireRetainedHtmlDataAccessible(ArtifactRecord record) {
        boolean htmlArtifact = ArtifactKind.SITE.name().equals(record.getKind())
            || ArtifactMediaTypeResolver.isHtml(record.getOriginalName());
        if (!ArtifactStatus.READY.name().equals(record.getStatus())
            || record.getPurgeAt() == null || !record.getPurgeAt().isAfter(LocalDateTime.now())
            || !htmlArtifact) {
            throw new IllegalArgumentException("Artifact数据已不可访问");
        }
    }

    /**
     * Extends physical retention after a valid access. Day-boundary rounding limits metadata writes to once per day.
     */
    private void renewPurgeAfterAccess(ArtifactRecord record) {
        if (!ArtifactStatus.READY.name().equals(record.getStatus()) || record.getPurgeAt() == null) {
            return;
        }
        LocalDateTime now = LocalDateTime.now();
        if (!record.getPurgeAt().isAfter(now)) {
            return;
        }
        long retentionSeconds = validatedPurgeRetentionSeconds();
        LocalDateTime retentionBase = record.getExpiresAt() != null && record.getExpiresAt().isAfter(now)
            ? record.getExpiresAt() : now;
        LocalDateTime target = roundUpToDay(retentionBase.plusSeconds(retentionSeconds));
        if (!record.getPurgeAt().isBefore(target)) {
            return;
        }
        int updated = artifactMapper.renewPurgeAt(record.getArtifactId(), target, now);
        if (updated == 1) {
            record.setPurgeAt(target);
            record.setUpdateTime(now);
        }
    }

    private ArtifactDto toDto(ArtifactRecord record, String accessKey, List<String> warnings) {
        String previewUrl = null;
        String downloadUrl = null;
        String publicPath = "/" + record.getArtifactId();
        if (!ArtifactKind.DOWNLOAD_ONLY.name().equals(record.getKind())) {
            previewUrl = buildPublicUrl(properties.getPreviewPathPrefix() + publicPath + "/");
        }
        downloadUrl = buildPublicUrl(properties.getDownloadPathPrefix() + publicPath);
        return ArtifactDto.builder()
            .artifactId(record.getArtifactId())
            .kind(record.getKind())
            .status(record.getStatus())
            .fileName(record.getOriginalName())
            .entryPoint(record.getEntryPoint())
            .size(record.getFileSize())
            .sha256(record.getSha256())
            .previewUrl(previewUrl)
            .downloadUrl(downloadUrl)
            .accessKey(accessKey)
            .expiresAt(record.getExpiresAt() == null
                ? null : record.getExpiresAt().atZone(ZoneId.systemDefault()).toOffsetDateTime())
            .purgeAt(record.getPurgeAt() == null
                ? null : record.getPurgeAt().atZone(ZoneId.systemDefault()).toOffsetDateTime())
            .warnings(warnings)
            .build();
    }

    private String buildPublicUrl(String path) {
        String base = StringUtils.removeEnd(StringUtils.trimToEmpty(properties.getPublicBaseUrl()), "/");
        String normalizedPath = path.startsWith("/") ? path : "/" + path;
        return base + normalizedPath;
    }

    private void validateUpload(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("上传文件不能为空");
        }
        if (file.getSize() > properties.getMaxUploadBytes()) {
            throw new IllegalArgumentException("上传文件超过300MB限制");
        }
    }

    private long validateExpiry(Long expiresInSeconds) {
        long value = expiresInSeconds == null ? properties.getDefaultExpiresSeconds() : expiresInSeconds;
        if (value <= 0 || value > properties.getMaxExpiresSeconds()) {
            throw new IllegalArgumentException("expiresInSeconds必须大于0且不超过" + properties.getMaxExpiresSeconds());
        }
        return value;
    }

    private long validatedPurgeRetentionSeconds() {
        long value = properties.getPurgeRetentionSeconds();
        if (value <= 0) {
            throw new IllegalStateException("artifact.lifecycle.purge-retention-seconds必须大于0");
        }
        return value;
    }

    private LocalDateTime latest(LocalDateTime first, LocalDateTime second, LocalDateTime third) {
        LocalDateTime result = first.isAfter(second) ? first : second;
        return result.isAfter(third) ? result : third;
    }

    private LocalDateTime roundUpToDay(LocalDateTime value) {
        LocalDateTime startOfDay = value.toLocalDate().atStartOfDay();
        return value.equals(startOfDay) ? value : startOfDay.plusDays(1);
    }

    private boolean isZip(MultipartFile file, String fileName) throws IOException {
        byte[] signature = new byte[4];
        int read;
        try (InputStream input = file.getInputStream()) {
            read = input.read(signature);
        }
        boolean zipSignature = read == 4 && signature[0] == 'P' && signature[1] == 'K'
            && ((signature[2] == 3 && signature[3] == 4)
                || (signature[2] == 5 && signature[3] == 6)
                || (signature[2] == 7 && signature[3] == 8));
        boolean zipExtension = fileName.toLowerCase(Locale.ROOT).endsWith(".zip");
        if (zipExtension && !zipSignature) {
            throw new IllegalArgumentException("ZIP文件格式无效");
        }
        return zipSignature;
    }

    private String calculateSha256(MultipartFile file) throws IOException {
        MessageDigest digest = sha256Digest();
        byte[] buffer = new byte[8192];
        try (InputStream input = file.getInputStream()) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private byte[] readPrefix(MultipartFile file, int maximumBytes) throws IOException {
        try (InputStream input = file.getInputStream()) {
            return input.readNBytes(maximumBytes);
        }
    }

    private String sha256Hex(byte[] value) {
        MessageDigest digest = sha256Digest();
        return HexFormat.of().formatHex(digest.digest(value));
    }

    private MessageDigest sha256Digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        }
        catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("当前JVM不支持SHA-256", e);
        }
    }

    private String generateManagementAccessKey() {
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String safeOriginalName(String originalName) {
        String value = StringUtils.defaultIfBlank(originalName, "artifact.bin").replace('\\', '/');
        int slash = value.lastIndexOf('/');
        value = slash >= 0 ? value.substring(slash + 1) : value;
        if (value.isBlank() || ".".equals(value) || "..".equals(value)) {
            throw new IllegalArgumentException("上传文件名无效");
        }
        return value;
    }

    private String storageFileName(String originalName) {
        return originalName.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private String normalizeEntryPoint(String entryPoint) {
        String value = StringUtils.defaultIfBlank(entryPoint, "index.html").replace('\\', '/');
        return normalizeRelativePath(value, "站点入口路径无效");
    }

    private String normalizeRequestedPath(String requestedPath) {
        String value = StringUtils.trimToEmpty(requestedPath).replace('\\', '/');
        while (value.startsWith("/")) {
            value = value.substring(1);
        }
        if (value.isBlank()) {
            return "";
        }
        return normalizeRelativePath(value, "预览资源路径无效");
    }

    private String normalizeRelativePath(String value, String errorMessage) {
        List<String> segments = new ArrayList<>();
        for (String segment : value.split("/")) {
            if (segment.isBlank() || ".".equals(segment)) {
                continue;
            }
            if ("..".equals(segment) || segment.contains("\u0000") || segment.matches("^[A-Za-z]:.*")) {
                throw new IllegalArgumentException(errorMessage);
            }
            segments.add(segment);
        }
        if (segments.isEmpty()) {
            throw new IllegalArgumentException(errorMessage);
        }
        return String.join("/", segments);
    }

    private String join(String prefix, String path) {
        return StringUtils.removeEnd(prefix, "/") + "/" + StringUtils.removeStart(path, "/");
    }

    @SuppressWarnings("unchecked")
    private List<String> parseWarnings(String json) {
        if (StringUtils.isBlank(json)) {
            return List.of();
        }
        return JSON.parseArray(json, String.class);
    }

    private record Publication(ArtifactKind kind, String entryPoint, long expandedSize, List<String> warnings) {
    }

    public record ArtifactContent(ArtifactRecord record, String objectKey, String fileName, FileMetadata metadata) {
    }
}
