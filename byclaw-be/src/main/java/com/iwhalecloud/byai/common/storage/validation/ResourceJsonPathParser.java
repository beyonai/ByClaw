package com.iwhalecloud.byai.common.storage.validation;

import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/**
 * 解析 ResourceFS.write 的目标路径，并识别标准资源 JSON 文件。
 */
@Component
public class ResourceJsonPathParser {

    private static final Pattern STANDARD_RESOURCE_JSON_PATH = Pattern.compile(
        "^/?resource/([^/]+)/([A-Za-z][A-Za-z0-9_]*)_(\\d+)\\.json$");

    public Optional<ResourceJsonPath> parse(MultipartFile multipartFile, String filePath) {
        String targetPath = resolveTargetPath(multipartFile, filePath);
        if (StringUtils.isBlank(targetPath)) {
            return Optional.empty();
        }

        Matcher matcher = STANDARD_RESOURCE_JSON_PATH.matcher(targetPath);
        if (!matcher.matches()) {
            return Optional.empty();
        }

        String resourceDirectory = matcher.group(1);
        String resourceBizType = matcher.group(2);
        if (!isConsistentResourcePath(resourceDirectory, resourceBizType)) {
            return Optional.empty();
        }

        return Optional.of(new ResourceJsonPath(targetPath, resourceDirectory, resourceBizType,
            Long.parseLong(matcher.group(3))));
    }

    private String resolveTargetPath(MultipartFile multipartFile, String filePath) {
        if (StringUtils.isBlank(filePath)) {
            return "";
        }
        String normalized = normalizePath(filePath);
        if (!normalized.endsWith("/")) {
            return normalized;
        }
        if (multipartFile == null || StringUtils.isBlank(multipartFile.getOriginalFilename())) {
            return normalized;
        }
        return normalized + multipartFile.getOriginalFilename();
    }

    private String normalizePath(String filePath) {
        String normalized = filePath.trim().replace('\\', '/').replaceAll("/+", "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        return normalized;
    }

    private boolean isConsistentResourcePath(String resourceDirectory, String resourceBizType) {
        String normalizedDirectory = StringUtils.trimToEmpty(resourceDirectory).toLowerCase(Locale.ROOT);
        String normalizedBizType = StringUtils.trimToEmpty(resourceBizType).toLowerCase(Locale.ROOT);
        return normalizedDirectory.equals(normalizedBizType)
            || ("doc".equals(normalizedDirectory) && normalizedBizType.startsWith("kg_"));
    }
}
