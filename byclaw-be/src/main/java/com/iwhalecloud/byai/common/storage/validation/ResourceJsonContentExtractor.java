package com.iwhalecloud.byai.common.storage.validation;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/**
 * 从 MultipartFile 中提取资源 JSON 字符串。
 */
@Component
public class ResourceJsonContentExtractor {

    private static final Logger LOGGER = LoggerFactory.getLogger(ResourceJsonContentExtractor.class);

    private final ResourceJsonValidationMessages messages;

    public ResourceJsonContentExtractor(ResourceJsonValidationMessages messages) {
        this.messages = messages;
    }

    public String extractJson(MultipartFile multipartFile, ResourceJsonPath resourceJsonPath) {
        if (multipartFile == null) {
            throw new IllegalArgumentException(messages.get("resource.json.file.empty", resourceJsonPath.targetPath()));
        }
        try {
            return new String(multipartFile.getBytes(), StandardCharsets.UTF_8);
        }
        catch (IOException e) {
            throw new IllegalArgumentException(messages.get("resource.json.content.read.failed",
                resourceJsonPath.targetPath()), e);
        }
    }
}
