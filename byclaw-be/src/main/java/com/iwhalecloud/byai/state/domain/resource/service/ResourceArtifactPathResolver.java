package com.iwhalecloud.byai.state.domain.resource.service;

import java.util.Locale;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 资源产物路径解析器。
 *
 * 职责说明：
 * 1. 统一资源 JSON、对象/视图 bundle 在远端存储中的目录命名规则；
 * 2. 把开放资源目录的相对路径解释成底层存储可执行的目标位置；
 * 3. 让业务层始终只表达“资源相对路径”，不再关心具体存储协议的根路径差异。
 *
 * 配置约定：
 * 1. 文件系统类存储下，file.storage.ftp.path 表示开放资源父目录，例如 /data/byai/openclaw/public/，最终会自动挂到 /resource；
 * 2. 对象存储类存储下，bucket 由 file.storage.minio.bucket_name 指定，资源前缀固定为 resource/；
 * 3. 业务层永远只拼接 resourceBizType 目录和文件名，根路径由本解析器负责展开。
 * @author qin.guoquan
 * @date 2026-04-18 15:00:08
 */
@Component
public class ResourceArtifactPathResolver {

    @Value("${file.storage.ftp.path:}")
    private String storageBasePath;

    @Value("${file.storage.minio.bucket_name:byclaw}")
    private String minioBucketName;

    private static final String RESOURCE_ROOT = "resource";

    private static final String KNOWLEDGE_DIRECTORY = "doc";

    public String resolveResourceDirectory(String resourceBizType) {
        if (StringUtils.isBlank(resourceBizType)) {
            return "unknown";
        }
        if (StringUtils.startsWithIgnoreCase(StringUtils.trimToEmpty(resourceBizType), "KG_")) {
            return KNOWLEDGE_DIRECTORY;
        }
        return resourceBizType.toLowerCase(Locale.ROOT);
    }

    public String buildResourceJsonFileName(String resourceBizType, long resourceId) {
        String typePart = StringUtils.isBlank(resourceBizType)
            ? "UNKNOWN"
            : resourceBizType.toUpperCase(Locale.ROOT);
        return typePart + "_" + resourceId + ".json";
    }

    public String resolveFtpAbsoluteBasePath() {
        String normalizedBasePath = normalizeBasePath(storageBasePath);
        if (StringUtils.isBlank(normalizedBasePath)) {
            return "";
        }
        String base = stripTrailingSlash(normalizedBasePath);
        return base.endsWith("/" + RESOURCE_ROOT) ? base : base + "/" + RESOURCE_ROOT;
    }

    public String resolveMinioBucketName() {
        return StringUtils.defaultIfBlank(StringUtils.trimToEmpty(minioBucketName), "byclaw");
    }

    public String resolveMinioPrefix() {
        return RESOURCE_ROOT;
    }

    public String buildMinioResourceObjectKey(String relativePath) {
        String prefix = resolveMinioPrefix();
        String normalizedRelativePath = normalizeRelativePath(relativePath);
        if (StringUtils.isBlank(prefix)) {
            return normalizedRelativePath;
        }
        return StringUtils.isBlank(normalizedRelativePath) ? prefix : prefix + "/" + normalizedRelativePath;
    }

    public String buildMinioResourceObjectKey(String subDirectory, String fileName) {
        String relativePath = normalizeRelativePath(subDirectory);
        if (StringUtils.isBlank(relativePath)) {
            return buildMinioResourceObjectKey(fileName);
        }
        return buildMinioResourceObjectKey(relativePath + "/" + fileName);
    }

    public String normalizeRelativePath(String path) {
        if (path == null) {
            return "";
        }
        String normalized = path.trim().replace('\\', '/');
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/") && normalized.length() > 1) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    public String appendTrailingSlash(String path) {
        String normalized = normalizeRelativePath(path);
        return StringUtils.isBlank(normalized) ? "" : normalized + "/";
    }

    private String normalizeBasePath(String basePath) {
        if (basePath == null) {
            return "";
        }
        String normalized = basePath.trim().replace('\\', '/');
        while (normalized.endsWith("/") && normalized.length() > 1) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (StringUtils.isBlank(normalized)) {
            return "";
        }
        return normalized.startsWith("/") ? normalized : "/" + normalized;
    }

    private String stripTrailingSlash(String path) {
        if (StringUtils.isBlank(path)) {
            return "";
        }
        String normalized = path.trim().replace('\\', '/');
        while (normalized.endsWith("/") && normalized.length() > 1) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

}
