package com.iwhalecloud.byai.state.domain.file.service;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;

/**
 * Resolves conversation file logical paths independent of the storage backend.
 */
@Component
public class ConversationStoragePathResolver {

    public static final String NAMESPACE = "conversation";

    public static final String SESSION_OBJECT_PREFIX = "/.sessions";

    @Autowired
    private UserBucketNamingService userBucketNamingService;

    public StorageLocation conversationFile(String userCode, String sessionId, String filePath) {
        if (StringUtils.isBlank(sessionId)) {
            throw new IllegalArgumentException("sessionId不能为空");
        }
        String normalizedFilePath = stripLeadingSlash(normalizeDisplayFilePath(filePath));
        String sessionPrefix = SESSION_OBJECT_PREFIX + "/" + sessionId.trim() + "/";
        String objectKey = sessionPrefix + normalizedFilePath;
        return StorageLocation.of(NAMESPACE, userBucketNamingService.buildUserBucketName(userCode), objectKey);
    }

    public StorageLocation objectKey(String userCode, String objectKey) {
        return StorageLocation.of(NAMESPACE, userBucketNamingService.buildUserBucketName(userCode), objectKey);
    }

    public StoragePrefix userBucketPrefix(String userCode, String prefix) {
        return StoragePrefix.of(NAMESPACE, userBucketNamingService.buildUserBucketName(userCode), prefix);
    }

    public String normalizeDisplayFilePath(String filePath) {
        if (StringUtils.isBlank(filePath)) {
            throw new IllegalArgumentException("filePath不能为空");
        }
        String normalized = filePath.trim().replace('\\', '/').replaceAll("/+", "/");
        normalized = stripLeadingSlash(normalized);
        if (StringUtils.isBlank(normalized)) {
            throw new IllegalArgumentException("filePath不能为空");
        }
        for (String part : normalized.split("/")) {
            if ("..".equals(part)) {
                throw new IllegalArgumentException("filePath不能包含..路径穿越片段");
            }
        }
        return "/" + normalized;
    }

    private static String stripLeadingSlash(String path) {
        String result = path;
        while (StringUtils.startsWith(result, "/")) {
            result = result.substring(1);
        }
        return result;
    }
}
