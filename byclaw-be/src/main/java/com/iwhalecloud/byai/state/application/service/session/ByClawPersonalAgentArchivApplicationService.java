package com.iwhalecloud.byai.state.application.service.session;

import java.net.URLConnection;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService.FsDownload;
import com.iwhalecloud.byai.state.domain.fs.dto.FsFileDeleteRequest;
import com.iwhalecloud.byai.state.domain.fs.enums.FsSpaceType;
import com.iwhalecloud.byai.state.domain.fs.vo.FsFileMetadataVo;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawPersonalAgentArchiveDto;

/**
 * 个人 agent tar.gz 档案应用服务。
 *
 * 路径口径固定为：
 * - bucket: byclaw-{userCode}
 * - objectKey: /by/.personal-agents/{resourceId}/{originalFilename}
 *
 * 允许同一 resourceId 下多个 tar.gz 并存；同名上传时覆盖原文件。
 *
 * @author qin.guoquan
 * @date 2026-05-20
 */
@Service
public class ByClawPersonalAgentArchivApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(ByClawPersonalAgentArchivApplicationService.class);

    @Autowired
    private FsOperationApplicationService fsOperationApplicationService;

    public ByClawPersonalAgentArchiveDto uploadTarGz(String userCode, Long resourceId, MultipartFile file) {
        validateUserAndResource(userCode, resourceId);
        validateUploadFile(file);
        String originalFilename = extractOriginalFilename(file);
        String archivePath = buildArchivePath(resourceId, originalFilename);
        String contentType = StringUtils.defaultIfBlank(file.getContentType(), guessContentType(originalFilename));

        // 显式先删后写，确保同名语义稳定为覆盖；底层读写统一收口到 FsOperationApplicationService。
        fsOperationApplicationService.deleteFileAsUser(userCode, buildDeleteRequest(resourceId, archivePath));
        FsFileMetadataVo metadata = fsOperationApplicationService.putFileAsUser(userCode, FsSpaceType.USER.name(),
            null, archivePath, contentType, file);
        logger.info("personal-agent tar.gz 上传完成, userCode={}, resourceId={}, archivePath={}", userCode, resourceId,
            archivePath);
        return buildDto(userCode, resourceId, originalFilename, archivePath, file.getSize(), contentType, metadata);
    }

    public List<ByClawPersonalAgentArchiveDto> queryTarGzList(String userCode, Long resourceId, String keyword) {
        validateUserAndResource(userCode, resourceId);
        String normalizedKeyword = StringUtils.trimToEmpty(keyword).toLowerCase(Locale.ROOT);
        String archiveRoot = buildArchiveRoot(resourceId);
        List<String> objectKeys = fsOperationApplicationService.listFilesAsUser(userCode, FsSpaceType.USER.name(),
            null, archiveRoot, null);
        if (objectKeys == null || objectKeys.isEmpty()) {
            return Collections.emptyList();
        }

        Map<String, ByClawPersonalAgentArchiveDto> fileMap = new LinkedHashMap<>();
        for (String objectKey : objectKeys) {
            collectTarGz(fileMap, userCode, resourceId, archiveRoot, objectKey);
        }
        return fileMap.values().stream().filter(dto -> matchKeyword(dto.getFileName(), normalizedKeyword))
            .sorted(Comparator.comparing(ByClawPersonalAgentArchiveDto::getFileName)).collect(Collectors.toList());
    }

    public PersonalAgentTarGzDownload prepareDownload(String userCode, Long resourceId, String archivePath) {
        validateUserAndResource(userCode, resourceId);
        String normalizedArchivePath = normalizeArchivePath(archivePath, resourceId);
        ensureArchiveExists(userCode, normalizedArchivePath);
        String fileName = extractFileName(normalizedArchivePath);
        FsDownload download = fsOperationApplicationService.downloadFileAsUser(userCode, FsSpaceType.USER.name(), null,
            normalizedArchivePath);
        StreamingResponseBody body = download.getBody();
        return new PersonalAgentTarGzDownload(fileName, body);
    }

    public ByClawPersonalAgentArchiveDto deleteTarGz(String userCode, Long resourceId, String archivePath) {
        validateUserAndResource(userCode, resourceId);
        String normalizedArchivePath = normalizeArchivePath(archivePath, resourceId);
        ensureArchiveExists(userCode, normalizedArchivePath);

        fsOperationApplicationService.deleteFileAsUser(userCode, buildDeleteRequest(resourceId, normalizedArchivePath));
        logger.info("personal-agent tar.gz 删除完成, userCode={}, resourceId={}, archivePath={}", userCode,
            resourceId, normalizedArchivePath);
        return buildDto(userCode, resourceId, extractFileName(normalizedArchivePath), normalizedArchivePath, null,
            guessContentType(normalizedArchivePath), null);
    }

    private void validateUserAndResource(String userCode, Long resourceId) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }
        if (resourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }
    }

    private void validateUploadFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.personal.agent.archive.empty"));
        }
        String originalFilename = extractOriginalFilename(file);
        if (!isTarGzFile(originalFilename)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.personal.agent.archive.file.invalid"));
        }
    }

    private String extractOriginalFilename(MultipartFile file) {
        String originalFilename = file == null ? null : file.getOriginalFilename();
        String normalized = originalFilename == null ? null : originalFilename.replace('\\', '/');
        int slash = normalized == null ? -1 : normalized.lastIndexOf('/');
        String fileName = slash >= 0 ? normalized.substring(slash + 1) : normalized;
        if (StringUtils.isBlank(fileName)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.personal.agent.archive.file.invalid"));
        }
        return fileName;
    }

    private void collectTarGz(Map<String, ByClawPersonalAgentArchiveDto> fileMap, String userCode, Long resourceId,
        String archiveRoot, String objectKey) {
        if (StringUtils.isBlank(objectKey) || !objectKey.startsWith(archiveRoot)) {
            return;
        }
        String relative = objectKey.substring(archiveRoot.length());
        String[] segments = StringUtils.split(relative, '/');
        if (segments == null || segments.length != 1 || !isTarGzFile(segments[0])) {
            return;
        }
        fileMap.putIfAbsent(segments[0],
            buildDto(userCode, resourceId, segments[0], archiveRoot + segments[0], null, guessContentType(segments[0]),
                null));
    }

    private boolean matchKeyword(String fileName, String normalizedKeyword) {
        if (StringUtils.isBlank(normalizedKeyword)) {
            return true;
        }
        return StringUtils.defaultString(fileName).toLowerCase(Locale.ROOT).contains(normalizedKeyword);
    }

    private void ensureArchiveExists(String userCode, String archivePath) {
        List<String> objectKeys = fsOperationApplicationService.listFilesAsUser(userCode, FsSpaceType.USER.name(),
            null, archivePath, 1);
        List<String> safeKeys = objectKeys == null ? new ArrayList<>() : objectKeys;
        boolean exists = safeKeys.stream().anyMatch(archivePath::equals);
        if (!exists) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.personal.agent.archive.notfound"));
        }
    }

    private String normalizeArchivePath(String archivePath, Long resourceId) {
        if (StringUtils.isBlank(archivePath)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.personal.agent.archive.path.invalid"));
        }
        String normalized = archivePath.replace('\\', '/').replaceAll("/+", "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        for (String seg : normalized.split("/")) {
            if ("..".equals(seg)) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.personal.agent.archive.path.invalid"));
            }
        }
        String archiveRoot = buildArchiveRoot(resourceId);
        if (!normalized.startsWith(archiveRoot)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.personal.agent.archive.path.invalid"));
        }
        String tail = normalized.substring(archiveRoot.length());
        if (StringUtils.isBlank(tail) || tail.contains("/") || !isTarGzFile(tail)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.personal.agent.archive.path.invalid"));
        }
        return normalized;
    }

    private boolean isTarGzFile(String fileName) {
        return StringUtils.isNotBlank(fileName) && fileName.toLowerCase(Locale.ROOT).endsWith(".tar.gz");
    }

    private String buildArchiveRoot(Long resourceId) {
        return ByClawUserWorkspacePaths.buildPersonalAgentArchiveRootPrefix(resourceId);
    }

    private String buildArchivePath(Long resourceId, String fileName) {
        return ByClawUserWorkspacePaths.buildPersonalAgentArchivePath(resourceId, fileName);
    }

    private String extractFileName(String archivePath) {
        int slash = archivePath.lastIndexOf('/');
        return slash >= 0 ? archivePath.substring(slash + 1) : archivePath;
    }

    private String guessContentType(String fileName) {
        String guessed = URLConnection.guessContentTypeFromName(fileName);
        return StringUtils.defaultIfBlank(guessed, "application/gzip");
    }

    private FsFileDeleteRequest buildDeleteRequest(Long resourceId, String archivePath) {
        FsFileDeleteRequest request = new FsFileDeleteRequest();
        request.setSpaceType(FsSpaceType.USER.name());
        request.setResourceId(resourceId);
        request.setPath(archivePath);
        return request;
    }

    private ByClawPersonalAgentArchiveDto buildDto(String userCode, Long resourceId, String fileName,
        String archivePath, Long fileSize, String contentType, FsFileMetadataVo metadata) {
        ByClawPersonalAgentArchiveDto dto = new ByClawPersonalAgentArchiveDto();
        dto.setFileName(fileName);
        dto.setArchivePath(archivePath);
        dto.setObjectKey(toObjectKey(archivePath));
        dto.setResourceId(resourceId);
        dto.setUserCode(userCode);
        dto.setFileSize(fileSize != null ? fileSize : metadata == null ? null : metadata.getFileSize());
        dto.setContentType(StringUtils.defaultIfBlank(contentType, metadata == null ? null : metadata.getContentType()));
        return dto;
    }

    private String toObjectKey(String archivePath) {
        return ByClawUserWorkspacePaths.toUserFsObjectKey(archivePath);
    }

    public static final class PersonalAgentTarGzDownload {
        private final String fileName;

        private final StreamingResponseBody body;

        private PersonalAgentTarGzDownload(String fileName, StreamingResponseBody body) {
            this.fileName = fileName;
            this.body = body;
        }

        public String getFileName() {
            return fileName;
        }

        public StreamingResponseBody getBody() {
            return body;
        }
    }
}
