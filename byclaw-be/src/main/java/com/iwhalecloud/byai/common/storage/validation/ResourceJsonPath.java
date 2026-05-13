package com.iwhalecloud.byai.common.storage.validation;

/**
 * 标准资源 JSON 路径解析结果。
 */
public record ResourceJsonPath(String targetPath, String resourceDirectory, String resourceBizType, Long resourceId) {
}
