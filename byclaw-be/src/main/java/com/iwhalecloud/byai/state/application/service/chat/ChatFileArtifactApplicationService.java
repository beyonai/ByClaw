package com.iwhalecloud.byai.state.application.service.chat;

import java.io.InputStream;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.Callable;

import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.io.FilenameUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService.FsDownload;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatFileArtifactResolveRequest;
import com.iwhalecloud.byai.state.domain.chat.vo.ChatFileArtifactVo;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

/**
 * 将回复文本中的文件路径解析为受会话可见性保护的下载文件。
 *
 * 创建人、会话用户成员、项目可见成员和平台管理员可读取已归档的会话文件；只有会话创建人可以把自己
 * UserFS 中的其他文件归档到会话目录。下载始终限制在当前会话目录内。
 *
 * @author qin.guoquan
 * @date 2026-08-18 20:00:38
 */
@Service
public class ChatFileArtifactApplicationService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ChatFileArtifactApplicationService.class);

    private static final int MAX_PATH_COUNT = 20;

    private static final int MAX_PATH_LENGTH = 2048;

    private static final int MAX_MESSAGE_SEGMENT_LENGTH = 64;

    private static final String USER_SPACE_PREFIX = "/by";

    private static final String SESSION_ROOT = "/.sessions/";

    private static final String ADMIN_VIP_USER_CODE = "adminvip";

    private final SessionService sessionService;

    private final SessionMemberService sessionMemberService;

    private final ProjectService projectService;

    private final ProjectMemberService projectMemberService;

    private final LoginApplicationService loginApplicationService;

    private final FsOperationApplicationService fsOperationApplicationService;

    private final UserFS userFS;

    public ChatFileArtifactApplicationService(SessionService sessionService, SessionMemberService sessionMemberService,
        ProjectService projectService, ProjectMemberService projectMemberService,
        LoginApplicationService loginApplicationService, FsOperationApplicationService fsOperationApplicationService,
        UserFS userFS) {
        this.sessionService = sessionService;
        this.sessionMemberService = sessionMemberService;
        this.projectService = projectService;
        this.projectMemberService = projectMemberService;
        this.loginApplicationService = loginApplicationService;
        this.fsOperationApplicationService = fsOperationApplicationService;
        this.userFS = userFS;
    }

    public List<ChatFileArtifactVo> resolve(ChatFileArtifactResolveRequest request) {
        if (request == null || request.getSessionId() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "chat.file.artifact.session.not.empty");
        }
        ByaiSession session = requireSessionAccess(request.getSessionId());
        if (request.getPaths() == null || request.getPaths().isEmpty()) {
            return List.of();
        }

        String ownerUserCode = resolveSessionOwnerUserCode(session);
        if (StringUtils.isBlank(ownerUserCode)) {
            // 文件附件只是历史消息的增强展示；创建人账号失效时不应阻断整条历史消息。
            LOGGER.debug("跳过无法确定会话文件所有者的解析: sessionId={}", session.getSessionId());
            return List.of();
        }
        LinkedHashSet<String> candidates = new LinkedHashSet<>(request.getPaths());
        List<ChatFileArtifactVo> result = new ArrayList<>();
        int processed = 0;
        for (String candidate : candidates) {
            if (processed >= MAX_PATH_COUNT) {
                break;
            }
            processed++;
            try {
                ChatFileArtifactVo artifact = resolveCandidate(session, ownerUserCode, request.getMessageId(), candidate);
                if (artifact != null) {
                    result.add(artifact);
                }
            }
            catch (RuntimeException e) {
                // 回复中的路径可能已经失效或只是示例。单个候选失败不影响整条消息展示。
                LOGGER.debug("跳过不可用的会话文件候选: sessionId={}, reason={}", session.getSessionId(),
                    e.getMessage());
            }
        }
        return result;
    }

    public FsDownload download(Long sessionId, String path) {
        ByaiSession session = requireSessionAccess(sessionId);
        String ownerUserCode = resolveSessionOwnerUserCode(session);
        if (StringUtils.isBlank(ownerUserCode)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                "chat.file.artifact.session.owner.not.exist");
        }
        String normalizedPath;
        try {
            normalizedPath = normalizeUserPath(path);
        }
        catch (BaseException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
        assertBelongsToSession(normalizedPath, sessionId);
        return fsOperationApplicationService.downloadFileAsUser(ownerUserCode, "USER", null, normalizedPath);
    }

    private ChatFileArtifactVo resolveCandidate(ByaiSession session, String ownerUserCode, String messageId,
        String candidate) {
        String sourcePath = normalizeUserPath(candidate);
        String sessionPrefix = sessionPrefix(session.getSessionId());
        String artifactPath = sourcePath;

        if (!StringUtils.startsWith(sourcePath, sessionPrefix)) {
            // 群成员只能读取已经归档到会话目录的文件，不能借会话权限读取创建人的私人 UserFS。
            if (!Objects.equals(session.getCreatorId(), CurrentUserHolder.getCurrentUserId())) {
                return null;
            }
            if (StringUtils.startsWith(sourcePath, SESSION_ROOT)) {
                return null;
            }
            artifactPath = archiveToSession(ownerUserCode, session.getSessionId(), messageId, sourcePath);
        }

        FileMetadata metadata = metadataAsUser(ownerUserCode, artifactPath);
        if (metadata == null) {
            return null;
        }
        String fileName = FilenameUtils.getName(artifactPath);
        return ChatFileArtifactVo.builder()
            .sourcePath(sourcePath)
            .path(artifactPath)
            .fileName(StringUtils.defaultIfBlank(metadata.getFileName(), fileName))
            .fileSize(metadata.getFileSize())
            .contentType(StringUtils.defaultIfBlank(metadata.getContentType(), guessContentType(fileName)))
            .build();
    }

    private String archiveToSession(String ownerUserCode, Long sessionId, String messageId, String sourcePath) {
        FileMetadata sourceMetadata = metadataAsUser(ownerUserCode, sourcePath);
        if (sourceMetadata == null || sourceMetadata.getFileSize() == null || sourceMetadata.getFileSize() < 0) {
            throw new BaseException("chat.file.artifact.metadata.unavailable");
        }
        String fileName = FilenameUtils.getName(sourcePath);
        if (StringUtils.isBlank(fileName)) {
            throw new BaseException("chat.file.artifact.file.name.empty");
        }
        String messageSegment = safeMessageSegment(messageId, sourcePath);
        String sourceHash = DigestUtils.sha256Hex(sourcePath).substring(0, 12);
        String targetPath = sessionPrefix(sessionId) + "artifacts/" + messageSegment + "/" + sourceHash + "/" + fileName;

        if (metadataAsUser(ownerUserCode, targetPath) != null) {
            return targetPath;
        }

        withUserContext(ownerUserCode, () -> {
            try (InputStream inputStream = userFS.read(sourcePath)) {
                if (inputStream == null) {
                    throw new BaseException("chat.file.artifact.file.not.exist");
                }
                userFS.write(inputStream, sourceMetadata.getFileSize(),
                    StringUtils.defaultIfBlank(sourceMetadata.getContentType(), guessContentType(fileName)), targetPath);
                return null;
            }
        });
        return targetPath;
    }

    private FileMetadata metadataAsUser(String userCode, String path) {
        try {
            return withUserContext(userCode, () -> userFS.metadata(path));
        }
        catch (RuntimeException e) {
            return null;
        }
    }

    private ByaiSession requireSessionAccess(Long sessionId) {
        if (sessionId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "chat.file.artifact.session.not.empty");
        }
        if (CurrentUserHolder.getLoginInfo() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "chat.file.artifact.session.access.denied");
        }
        ByaiSession session = sessionService.findById(sessionId);
        if (session == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "chat.file.artifact.session.not.exist");
        }
        if (canViewSession(session)) {
            return session;
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "chat.file.artifact.session.access.denied");
    }

    private boolean canViewSession(ByaiSession session) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (Objects.equals(session.getCreatorId(), currentUserId)
            || CurrentUserHolder.isPlatformAdminOrOperator()
            || ADMIN_VIP_USER_CODE.equalsIgnoreCase(CurrentUserHolder.getCurrentUserCode())
            || sessionMemberService.findSessionMember(session.getSessionId(), "USER", currentUserId) != null) {
            return true;
        }

        Long projectId = session.getProjectId();
        if (projectId == null) {
            return false;
        }
        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())
            || "default".equalsIgnoreCase(project.getProjectType())) {
            return false;
        }
        return Objects.equals(project.getCreateBy(), currentUserId)
            || projectMemberService.isMember(projectId, currentUserId);
    }

    private String resolveSessionOwnerUserCode(ByaiSession session) {
        if (Objects.equals(session.getCreatorId(), CurrentUserHolder.getCurrentUserId())) {
            return CurrentUserHolder.getCurrentUserCode();
        }
        LoginInfo ownerLoginInfo = loginApplicationService.getLoginInfo(session.getCreatorId());
        if (ownerLoginInfo == null || StringUtils.isBlank(ownerLoginInfo.getUserCode())) {
            return null;
        }
        return ownerLoginInfo.getUserCode();
    }

    private String normalizeUserPath(String path) {
        if (StringUtils.isBlank(path) || path.length() > MAX_PATH_LENGTH) {
            throw new BaseException("chat.file.artifact.path.invalid");
        }
        String normalized = path.trim().replace('\\', '/').replaceAll("/+", "/");
        normalized = StringUtils.removeStart(normalized, "file://");
        if (!StringUtils.startsWith(normalized, "/")) {
            normalized = "/" + normalized;
        }
        for (String part : StringUtils.split(normalized, '/')) {
            if (StringUtils.equals(part, "..")) {
                throw new BaseException("chat.file.artifact.path.invalid");
            }
        }
        String currentUserCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isNotBlank(currentUserCode)) {
            String currentUserBucketPrefix = "/" + com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver
                .buildUserBucketName(currentUserCode) + USER_SPACE_PREFIX;
            if (StringUtils.startsWith(normalized, currentUserBucketPrefix + "/")) {
                normalized = normalized.substring(currentUserBucketPrefix.length());
            }
        }
        if (StringUtils.startsWith(normalized, USER_SPACE_PREFIX + "/")) {
            normalized = normalized.substring(USER_SPACE_PREFIX.length());
        }
        if (StringUtils.endsWith(normalized, "/")) {
            throw new BaseException("chat.file.artifact.path.invalid");
        }
        return normalized;
    }

    private void assertBelongsToSession(String path, Long sessionId) {
        if (!StringUtils.startsWith(path, sessionPrefix(sessionId))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                "chat.file.artifact.path.not.in.session");
        }
    }

    private String sessionPrefix(Long sessionId) {
        return SESSION_ROOT + sessionId + "/";
    }

    private String safeMessageSegment(String messageId, String sourcePath) {
        String value = StringUtils.defaultIfBlank(messageId, DigestUtils.sha256Hex(sourcePath).substring(0, 16));
        String sanitized = value.trim().replaceAll("[^A-Za-z0-9_-]", "_");
        if (sanitized.length() > MAX_MESSAGE_SEGMENT_LENGTH) {
            return sanitized.substring(0, MAX_MESSAGE_SEGMENT_LENGTH);
        }
        return StringUtils.defaultIfBlank(sanitized, "message");
    }

    private String guessContentType(String fileName) {
        return StringUtils.defaultIfBlank(URLConnection.guessContentTypeFromName(fileName),
            "application/octet-stream");
    }

    private <T> T withUserContext(String userCode, Callable<T> callable) {
        LoginInfo originalLoginInfo = CurrentUserHolder.getLoginInfo();
        LoginInfo targetLoginInfo = new LoginInfo();
        targetLoginInfo.setUserCode(userCode);
        CurrentUserHolder.setLoginInfo(targetLoginInfo);
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
            if (originalLoginInfo == null) {
                CurrentUserHolder.clearLoginInfo();
            }
            else {
                CurrentUserHolder.setLoginInfo(originalLoginInfo);
            }
        }
    }
}
