package com.iwhalecloud.byai.state.application.service.session;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.Callable;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.ArchiveFS;
import com.iwhalecloud.byai.common.storage.ByclawArchiveFS;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.state.domain.session.dto.WorkspaceArchiveDto;

@Service
public class WorkspaceArchiveApplicationService {

    private static final Logger LOGGER = LoggerFactory.getLogger(WorkspaceArchiveApplicationService.class);

    private static final String ARCHIVE_ROOT = "/openclaw-workspace-archives";

    private static final String CANCEL_AUTH_ARCHIVE_KIND = "cancel_auth";

    private static final String DELETE_ARCHIVE_KIND = "delete";

    private static final String CANCEL_AUTH_ARCHIVE_FILE_NAME = "cancel_auth_latest.tar.gz";

    private static final String DELETE_ARCHIVE_FILE_NAME = "del_latest.tar.gz";

    @Autowired
    private ArchiveFS archiveFS;

    @Autowired
    private ObjectMapper objectMapper;

    public WorkspaceArchiveDto upload(String userCode, Long resourceId, String archiveKind, MultipartFile file,
        String expectedSha256) {
        validateUserAndResource(userCode, resourceId);
        String normalizedArchiveKind = normalizeArchiveKind(archiveKind);
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("workspace archive file不能为空");
        }

        return withUserContext(userCode, () -> {
            archiveFS.init();
            String archivePath = buildArchivePath(resourceId, normalizedArchiveKind);
            String metadataPath = buildMetadataPath(resourceId, normalizedArchiveKind);
            MessageDigest digest = sha256Digest();
            String contentType = StringUtils.defaultIfBlank(file.getContentType(), "application/gzip");

            FileMetadata metadata;
            try (InputStream raw = file.getInputStream(); DigestInputStream in = new DigestInputStream(raw, digest)) {
                metadata = archiveFS.write(in, file.getSize(), contentType, archivePath);
            }
            catch (IOException e) {
                throw new IllegalStateException("workspace archive上传失败: " + archivePath, e);
            }

            String actualSha256 = HexFormat.of().formatHex(digest.digest());
            if (StringUtils.isNotBlank(expectedSha256) && !actualSha256.equalsIgnoreCase(expectedSha256.trim())) {
                archiveFS.delete(archivePath);
                throw new IllegalArgumentException("workspace archive sha256校验失败");
            }

            WorkspaceArchiveDto dto = buildDto(userCode, resourceId, normalizedArchiveKind, true, archivePath,
                metadataPath);
            dto.setFileSize(file.getSize());
            dto.setContentType(contentType);
            dto.setSha256(actualSha256);
            dto.setExpectedSha256(StringUtils.trimToNull(expectedSha256));
            dto.setFileTag(metadata == null ? null : metadata.getFileTag());
            dto.setStorageType(metadata == null ? null : metadata.getStorageType());
            dto.setArchivedAt(DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(OffsetDateTime.now()));
            writeMetadata(metadataPath, dto);

            LOGGER.info("workspace archive上传完成, userCode={}, resourceId={}, archiveKind={}, archivePath={}, objectKey={}, size={}, sha256={}",
                userCode, resourceId, normalizedArchiveKind, archivePath, dto.getObjectKey(), file.getSize(),
                actualSha256);
            return dto;
        });
    }

    public WorkspaceArchiveDto status(String userCode, Long resourceId, String archiveKind) {
        validateUserAndResource(userCode, resourceId);
        String normalizedArchiveKind = normalizeArchiveKind(archiveKind);
        return withUserContext(userCode, () -> {
            archiveFS.init();
            String archivePath = buildArchivePath(resourceId, normalizedArchiveKind);
            String metadataPath = buildMetadataPath(resourceId, normalizedArchiveKind);
            WorkspaceArchiveDto dto = readMetadata(metadataPath);
            if (dto == null) {
                dto = buildDto(userCode, resourceId, normalizedArchiveKind, archiveExists(archivePath), archivePath,
                    metadataPath);
            }
            else {
                dto.setExists(archiveExists(archivePath));
            }
            dto.setUserCode(userCode);
            dto.setResourceId(resourceId);
            dto.setArchiveKind(normalizedArchiveKind);
            dto.setArchivePath(archivePath);
            dto.setObjectKey(toObjectKey(archivePath));
            dto.setMetadataPath(metadataPath);
            LOGGER.info("workspace archive状态查询完成, userCode={}, resourceId={}, archiveKind={}, exists={}, archivePath={}",
                userCode, resourceId, normalizedArchiveKind, dto.getExists(), archivePath);
            return dto;
        });
    }

    public StreamingResponseBody download(String userCode, Long resourceId, String archiveKind) {
        validateUserAndResource(userCode, resourceId);
        String normalizedArchiveKind = normalizeArchiveKind(archiveKind);
        String archivePath = buildArchivePath(resourceId, normalizedArchiveKind);
        return outputStream -> {
            try {
                withUserContext(userCode, () -> {
                    archiveFS.init();
                    if (!archiveExists(archivePath)) {
                        throw new IllegalArgumentException("workspace archive不存在: " + archivePath);
                    }
                    try (InputStream in = archiveFS.read(archivePath)) {
                        in.transferTo(outputStream);
                    }
                    outputStream.flush();
                    return null;
                });
                LOGGER.info("workspace archive下载完成, userCode={}, resourceId={}, archiveKind={}, archivePath={}",
                    userCode, resourceId, normalizedArchiveKind, archivePath);
            }
            catch (Exception e) {
                LOGGER.error("workspace archive下载失败, userCode={}, resourceId={}, archiveKind={}, archivePath={}",
                    userCode, resourceId, normalizedArchiveKind, archivePath, e);
                if (e instanceof IOException ioException) {
                    throw ioException;
                }
                if (e instanceof RuntimeException runtimeException) {
                    throw runtimeException;
                }
                throw new IOException(e);
            }
        };
    }

    public WorkspaceArchiveDto delete(String userCode, Long resourceId, String archiveKind) {
        validateUserAndResource(userCode, resourceId);
        String normalizedArchiveKind = normalizeArchiveKind(archiveKind);
        return withUserContext(userCode, () -> {
            archiveFS.init();
            String archivePath = buildArchivePath(resourceId, normalizedArchiveKind);
            String metadataPath = buildMetadataPath(resourceId, normalizedArchiveKind);
            archiveFS.delete(archivePath);
            archiveFS.delete(metadataPath);
            WorkspaceArchiveDto dto = buildDto(userCode, resourceId, normalizedArchiveKind, false, archivePath,
                metadataPath);
            LOGGER.info("workspace archive删除完成, userCode={}, resourceId={}, archiveKind={}, archivePath={}, objectKey={}",
                userCode, resourceId, normalizedArchiveKind, archivePath, toObjectKey(archivePath));
            return dto;
        });
    }

    public String getArchiveFileName(Long resourceId, String archiveKind) {
        return "workspace-baiying-agent-" + resourceId + "-" + archiveFileName(normalizeArchiveKind(archiveKind));
    }

    private void writeMetadata(String metadataPath, WorkspaceArchiveDto dto) {
        try {
            byte[] bytes = objectMapper.writeValueAsBytes(dto);
            archiveFS.write(new java.io.ByteArrayInputStream(bytes), bytes.length, "application/json", metadataPath);
        }
        catch (IOException e) {
            throw new IllegalStateException("workspace archive metadata写入失败: " + metadataPath, e);
        }
    }

    private WorkspaceArchiveDto readMetadata(String metadataPath) {
        if (!archiveExists(metadataPath)) {
            return null;
        }
        try (InputStream in = archiveFS.read(metadataPath); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            in.transferTo(out);
            return objectMapper.readValue(out.toString(StandardCharsets.UTF_8), WorkspaceArchiveDto.class);
        }
        catch (Exception e) {
            LOGGER.warn("workspace archive metadata读取失败，将回退到对象存在性判断, metadataPath={}", metadataPath, e);
            return null;
        }
    }

    private boolean archiveExists(String archivePath) {
        List<String> paths = archiveFS.list(archivePath, 1);
        return paths != null && paths.stream().anyMatch(archivePath::equals);
    }

    private static WorkspaceArchiveDto buildDto(String userCode, Long resourceId, String archiveKind, boolean exists,
        String archivePath, String metadataPath) {
        WorkspaceArchiveDto dto = new WorkspaceArchiveDto();
        dto.setExists(exists);
        dto.setUserCode(userCode);
        dto.setResourceId(resourceId);
        dto.setArchiveKind(archiveKind);
        dto.setArchivePath(archivePath);
        dto.setObjectKey(toObjectKey(archivePath));
        dto.setMetadataPath(metadataPath);
        return dto;
    }

    private static String buildArchiveDirectory(Long resourceId) {
        return ARCHIVE_ROOT + "/workspace-baiying-agent-" + resourceId + "/";
    }

    private static String buildArchivePath(Long resourceId, String archiveKind) {
        return buildArchiveDirectory(resourceId) + archiveFileName(archiveKind);
    }

    private static String buildMetadataPath(Long resourceId, String archiveKind) {
        return buildArchiveDirectory(resourceId) + archiveFileName(archiveKind) + ".metadata.json";
    }

    private static String toObjectKey(String archivePath) {
        String normalized = archivePath.startsWith("/") ? archivePath : "/" + archivePath;
        return ByclawArchiveFS.FS_ROOT_PATH + normalized;
    }

    private static String normalizeArchiveKind(String archiveKind) {
        String normalized = StringUtils.defaultIfBlank(archiveKind, CANCEL_AUTH_ARCHIVE_KIND).trim().toLowerCase();
        if (CANCEL_AUTH_ARCHIVE_KIND.equals(normalized) || DELETE_ARCHIVE_KIND.equals(normalized)) {
            return normalized;
        }
        throw new IllegalArgumentException("archiveKind仅支持 cancel_auth 或 delete");
    }

    private static String archiveFileName(String archiveKind) {
        return DELETE_ARCHIVE_KIND.equals(archiveKind) ? DELETE_ARCHIVE_FILE_NAME : CANCEL_AUTH_ARCHIVE_FILE_NAME;
    }

    private static MessageDigest sha256Digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        }
        catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm unavailable", e);
        }
    }

    private static void validateUserAndResource(String userCode, Long resourceId) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException("userCode不能为空");
        }
        if (resourceId == null || resourceId <= 0) {
            throw new IllegalArgumentException("resourceId必须为正整数");
        }
    }

    private static <T> T withUserContext(String userCode, Callable<T> callable) {
        LoginInfo originalLoginInfo = CurrentUserHolder.getLoginInfo();
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode(userCode.trim());
        CurrentUserHolder.setLoginInfo(loginInfo);
        try {
            return callable.call();
        }
        catch (RuntimeException e) {
            throw e;
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
        finally {
            restoreLoginInfo(originalLoginInfo);
        }
    }

    private static void restoreLoginInfo(LoginInfo originalLoginInfo) {
        if (originalLoginInfo == null) {
            CurrentUserHolder.clearLoginInfo();
            return;
        }
        CurrentUserHolder.setLoginInfo(originalLoginInfo);
    }
}
