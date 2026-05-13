package com.iwhalecloud.byai.manager.domain.resource.validator.impl;

import java.util.List;
import com.iwhalecloud.byai.manager.dto.resource.ResourceDto;
import org.apache.commons.lang3.StringUtils;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.resource.validator.AbstractResourceValidator;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.springframework.stereotype.Component;

/**
 * Tags格式验证器
 */
@Component
public class TagsResourceValidator extends AbstractResourceValidator {

    @Override
    protected void doValidate(ResourceDto resource) throws ByAiArgumentException {
        String tags = resource.getTags();
        if (StringUtils.isBlank(tags)) {
            return; // tags为空是允许的
        }

        validateBasicFormat(tags);
        validateJsonFormat(tags);
        validateContent(tags);
    }

    /**
     * 校验tags的基本格式
     */
    private void validateBasicFormat(String tags) {
        String trimmedTags = tags.trim();
        // 1. 基本格式校验：必须以[开头，]结尾
        if (!trimmedTags.startsWith("[") || !trimmedTags.endsWith("]")) {
            throw new ByAiArgumentException(I18nUtil.get("resource.validator.tags.format.invalid"));
        }

        // 2. 检查是否是单纯的非JSON格式字符串（不包含引号和逗号的情况）
        if (!trimmedTags.contains("\"")) {
            throw new ByAiArgumentException(I18nUtil.get("resource.validator.tags.format.invalid"));
        }

        // 3. 预检查常见的无效格式
        // 检查尾部逗号：],]
        if (trimmedTags.matches(".*,\\s*]$")) {
            throw new ByAiArgumentException(I18nUtil.get("resource.validator.tags.format.trailing.comma"));
        }

        // 检查是否像JSON对象（包含:）
        if (trimmedTags.contains(":")) {
            throw new ByAiArgumentException(I18nUtil.get("resource.validator.tags.format.not.array"));
        }
    }

    /**
     * 校验tags的JSON格式
     */
    private void validateJsonFormat(String tags) {
        try {
            // 尝试解析JSON
            Object parsedObj = JSON.parse(tags);

            // 确保是数组类型
            if (!(parsedObj instanceof List<?> tagsArray)) {
                throw new ByAiArgumentException(I18nUtil.get("resource.validator.tags.format.not.array"));
            }

            // 检查数组不能为空
            if (tagsArray.isEmpty()) {
                throw new ByAiArgumentException(I18nUtil.get("resource.validator.tags.empty"));
            }
        }
        catch (Exception e) {
            ByAiArgumentException ex = new ByAiArgumentException(
                I18nUtil.get("resource.validator.tags.format.invalid"));
            ex.initCause(e);
            throw ex;
        }
    }

    /**
     * 校验tags的内容
     */
    private void validateContent(String tags) {
        try {
            List<?> tagsArray = JSON.parseArray(tags);

            // 校验数组中的每个元素
            for (Object item : tagsArray) {
                // 检查null值
                if (item == null) {
                    throw new ByAiArgumentException(I18nUtil.get("resource.validator.tags.null.element"));
                }

                // 检查元素类型
                if (!(item instanceof String)) {
                    throw new ByAiArgumentException(
                        I18nUtil.get("resource.validator.tags.type.invalid", item.getClass().getSimpleName()));
                }

                String tag = (String) item;

                // 检查空字符串或只包含空格的字符串
                if (StringUtils.isBlank(tag)) {
                    throw new ByAiArgumentException(I18nUtil.get("resource.validator.tags.blank.element"));
                }
            }
        }
        catch (Exception e) {
            ByAiArgumentException ex = new ByAiArgumentException(
                I18nUtil.get("resource.validator.tags.content.invalid"));
            ex.initCause(e);
            throw ex;
        }
    }
}