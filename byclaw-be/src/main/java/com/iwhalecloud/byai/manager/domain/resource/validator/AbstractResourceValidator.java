package com.iwhalecloud.byai.manager.domain.resource.validator;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.dto.resource.ResourceDto;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

/**
 * 资源校验器抽象基类
 */
public abstract class AbstractResourceValidator {
    private static final Logger LOGGER = LoggerFactory.getLogger(AbstractResourceValidator.class);

    /**
     * 校验资源
     *
     * @param resource 资源对象
     * @throws ByAiArgumentException 校验失败时抛出异常
     */
    public void validate(ResourceDto resource) throws ByAiArgumentException {
        // 基础校验
        if (resource == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.validator.resource.notnull"));
        }

        // 调用子类特定的校验逻辑
        doValidate(resource);
    }

    /**
     * 子类实现的特定校验逻辑
     *
     * @param resource 资源对象
     * @throws ByAiArgumentException 校验失败时抛出异常
     */
    protected abstract void doValidate(ResourceDto resource) throws ByAiArgumentException;

    /**
     * 校验参数是否为空
     *
     * @param param 参数Map
     * @param paramName 参数�?
     * @throws ByAiArgumentException 如果参数为空则抛出异常
     */
    protected void validateParamNotEmpty(Map<String, Object> param, String paramName) {
        if (param == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.validator.param.notnull"));
        }

        if (!param.containsKey(paramName) || param.get(paramName) == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.validator.paramname.notnull", paramName));
        }

        if (param.get(paramName) instanceof String && StringUtils.isBlank((String) param.get(paramName))) {
            throw new ByAiArgumentException(I18nUtil.get("resource.validator.paramname.notnull", paramName));
        }
    }

    /**
     * 校验URL格式
     *
     * @param param 参数Map
     * @param urlParamName URL参数�?
     * @throws ByAiArgumentException 如果URL格式不正确则抛出异常
     */
    protected void validateUrl(Map<String, Object> param, String urlParamName) {
        validateParamNotEmpty(param, urlParamName);

        String url = param.get(urlParamName).toString();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw new ByAiArgumentException(I18nUtil.get("resource.validator.url.invalid", urlParamName));
        }
    }

    /**
     * 将对象转换为Map
     *
     * @param obj 对象
     * @return Map对象
     */
    protected Map<String, Object> convertToMap(Object obj) {
        if (obj == null) {
            return null;
        }

        if (obj instanceof Map) {
            return (Map<String, Object>) obj;
        }

        try {
            return JSON.parseObject(JSON.toJSONString(obj), Map.class);
        }
        catch (Exception e) {
            LOGGER.error("对象转Map失败: {}", e.getMessage(), e);
            return null;
        }
    }
}
