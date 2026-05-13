package com.iwhalecloud.byai.common.storage.validation;

import java.io.IOException;
import java.util.Optional;

import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 编排资源 JSON 写入前校验流程。
 */
@Component
public class ResourceJsonValidationService {

    private final ResourceJsonPathParser resourceJsonPathParser;
    private final ResourceJsonContentExtractor resourceJsonContentExtractor;
    private final ResourceJsonValidatorRouter resourceJsonValidatorRouter;
    private final ObjectMapper objectMapper;
    private final ResourceJsonValidationMessages messages;

    public ResourceJsonValidationService(ResourceJsonPathParser resourceJsonPathParser,
        ResourceJsonContentExtractor resourceJsonContentExtractor,
        ResourceJsonValidatorRouter resourceJsonValidatorRouter,
        ObjectMapper objectMapper,
        ResourceJsonValidationMessages messages) {

        this.resourceJsonPathParser = resourceJsonPathParser;
        this.resourceJsonContentExtractor = resourceJsonContentExtractor;
        this.resourceJsonValidatorRouter = resourceJsonValidatorRouter;
        this.objectMapper = objectMapper;
        this.messages = messages;
    }

    public void validateIfResourceJson(MultipartFile multipartFile, String filePath) {
        Optional<ResourceJsonPath> resourceJsonPath = resourceJsonPathParser.parse(multipartFile, filePath);
        if (resourceJsonPath.isEmpty()) {
            return;
        }

        String json = resourceJsonContentExtractor.extractJson(multipartFile, resourceJsonPath.get());
        JsonNode root = parseJsonObject(json, resourceJsonPath.get());
        resourceJsonValidatorRouter.validate(new ResourceJsonValidationContext(resourceJsonPath.get(), json, root));
    }

    private JsonNode parseJsonObject(String json, ResourceJsonPath resourceJsonPath) {
        try {
            JsonNode root = objectMapper.readTree(json);
            if (root == null || root.isNull() || !root.isObject()) {
                throw new IllegalArgumentException(messages.get("resource.json.object.required",
                    resourceJsonPath.targetPath()));
            }
            return root;
        }
        catch (IllegalArgumentException e) {
            throw e;
        }
        catch (IOException e) {
            throw new IllegalArgumentException(messages.get("resource.json.parse.failed",
                resourceJsonPath.targetPath()), e);
        }
    }
}
