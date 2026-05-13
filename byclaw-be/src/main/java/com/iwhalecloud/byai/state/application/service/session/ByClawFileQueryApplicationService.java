package com.iwhalecloud.byai.state.application.service.session;

import com.iwhalecloud.byai.common.storage.impl.MinioStorageService;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.state.common.filter.xss.XssFilter;
import com.iwhalecloud.byai.state.domain.chat.dto.UserSpaceDto;
import com.iwhalecloud.byai.state.domain.chat.vo.UserSpaceVo;
import com.iwhalecloud.byai.state.domain.file.service.ConversationStoragePathResolver;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.stream.Collectors;

import org.apache.commons.io.FilenameUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawFileDto;

/**
 * 用户 byclaw 文件查询应用服务。 职责说明： 1. 负责在指定用户上下文中查询 UserFS； 2. 负责控制“查询会话文件”的业务语义； 3. 负责将 UserFS 路径整理为前端可直接消费的文件列表结构。 * @author
 * qin.guoquan * @date 2026-04-18 19:38:18
 */
@Service
public class ByClawFileQueryApplicationService {

    private Logger logger = LoggerFactory.getLogger(ByClawFileQueryApplicationService.class);

    @Autowired
    private UserFS userFS;

    @Autowired
    private MinioStorageService minioStorageService;

    private static final String SESSION_ROOT_PREFIX = ConversationStoragePathResolver.SESSION_OBJECT_PREFIX + "/";

    private static final String AGENT_ROOT_PREFIX_TEMPLATE = "/by/.openclaw/workspace-baiying-agent-%s";

    /**
     * 查询指定用户在 UserFS 下的会话文件。 sessionId 必须来自前端当前对话，不是登录态 session，也不从后端上下文推导。 sessionId 为空时，返回 /.sessions/{任意会话目录}/{文件}
     * 下的全部会话文件。
     */
    public List<ByClawFileDto> qryByClawFileByUserCode(String userCode, String keyword, String sessionId) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }
        String normalizedSessionId = StringUtils.trimToEmpty(sessionId);
        String listPrefix = buildListPrefix(normalizedSessionId);

        List<String> objectKeys = safeObjectKeys(withUserContext(userCode, () -> userFS.list(listPrefix, null)));
        String normalizedKeyword = StringUtils.trimToEmpty(keyword).toLowerCase(Locale.ROOT);

        return objectKeys.stream().filter(StringUtils::isNotBlank)
            .map(ByClawFileQueryApplicationService::normalizeObjectKey)
            .filter(objectKey -> matchSessionScope(objectKey, normalizedSessionId))
            .filter(objectKey -> matchKeyword(objectKey, normalizedKeyword)).sorted(Comparator.naturalOrder())
            .map(objectKey -> new ByClawFileDto(objectKey, FilenameUtils.getName(objectKey), objectKey))
            .collect(Collectors.toList());
    }

    private String buildListPrefix(String normalizedSessionId) {
        if (StringUtils.isBlank(normalizedSessionId)) {
            return SESSION_ROOT_PREFIX;
        }
        return SESSION_ROOT_PREFIX + normalizedSessionId + "/";
    }

    private List<String> safeObjectKeys(List<String> objectKeys) {
        return objectKeys == null ? Collections.emptyList() : objectKeys;
    }

    /**
     * sessionId 为空时匹配 /.sessions/{任意会话目录}/{文件} 下全部文件； 不为空时只匹配 /.sessions/{sessionId}/{文件} 下的文件。
     */
    private boolean matchSessionScope(String objectKey, String normalizedSessionId) {
        if (!StringUtils.startsWith(objectKey, SESSION_ROOT_PREFIX)) {
            return false;
        }
        String relativePath = objectKey.substring(SESSION_ROOT_PREFIX.length());
        String[] segments = StringUtils.split(relativePath, '/');
        if (segments == null || segments.length < 2) {
            return false;
        }
        if (StringUtils.isBlank(normalizedSessionId)) {
            return StringUtils.isNotBlank(segments[0]) && StringUtils.isNotBlank(segments[1]);
        }
        return StringUtils.equals(segments[0], normalizedSessionId) && StringUtils.isNotBlank(segments[1]);
    }

    /**
     * 空间搜索同时支持按展示文件名和对象路径匹配，便于用户通过关键字快速过滤文件。
     */
    private boolean matchKeyword(String objectKey, String normalizedKeyword) {
        if (StringUtils.isBlank(normalizedKeyword)) {
            return true;
        }
        String normalizedObjectKey = StringUtils.defaultString(objectKey).toLowerCase();
        String normalizedFileName = FilenameUtils.getName(StringUtils.defaultString(objectKey)).toLowerCase();
        return normalizedObjectKey.contains(normalizedKeyword) || normalizedFileName.contains(normalizedKeyword);
    }

    private static String normalizeObjectKey(String objectKey) {
        String normalized = StringUtils.trimToEmpty(objectKey).replace('\\', '/').replaceAll("/+", "/");
        return normalized.startsWith("/") ? normalized : "/" + normalized;
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

    /**
     * 列出空间
     *
     * @param userSpaceDto 查询对象
     * @return List
     */
    public List<UserSpaceVo> listUserSpace(UserSpaceDto userSpaceDto) {

        String userCode = CurrentUserHolder.getCurrentUserCode();
        String bucketOrRoot = UserBucketNameResolver.buildUserBucketName(userCode);

        // 如果没有，走默认路径
        String prefix = userSpaceDto.getPrefix();
        Long resourceId = userSpaceDto.getResourceId();

        if (resourceId != null) {
            prefix = this.buildAgentRootPrefix(resourceId);
        }
        else if (StringUtil.isEmpty(prefix)) {
            prefix = "/by/.openclaw";
        }

        StoragePrefix storagePrefix = StoragePrefix.of("workspace", bucketOrRoot, prefix, "private", false);

        List<StorageObject> objects = minioStorageService.list(storagePrefix, null);

        List<UserSpaceVo> resultList = new ArrayList<>();
        for (StorageObject storageObject : objects) {
            UserSpaceVo userSpaceVo = new UserSpaceVo();

            String path = storageObject.getPath();
            userSpaceVo.setFilePath(path.startsWith("/") ? path : "/".concat(path));
            if (storageObject.isDir()) {
                // 拿到最后一级，自动忽略末尾/
                path = path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
                userSpaceVo.setName(StringUtils.substringAfterLast(path, "/"));
            }
            else {
                userSpaceVo.setName(StringUtils.substringAfterLast(path, "/"));
            }
            userSpaceVo.setDir(storageObject.isDir());
            resultList.add(userSpaceVo);
        }

        return resultList;
    }

    private String buildAgentRootPrefix(Long resourceId) {
        return String.format(AGENT_ROOT_PREFIX_TEMPLATE, resourceId);
    }
}
