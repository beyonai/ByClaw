package com.iwhalecloud.byai.common.storage.validation;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 资源 JSON 校验上下文。
 */
public record ResourceJsonValidationContext(ResourceJsonPath resourceJsonPath, String json, JsonNode root) {
}
