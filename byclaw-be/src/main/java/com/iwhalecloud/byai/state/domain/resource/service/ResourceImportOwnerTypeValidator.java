package com.iwhalecloud.byai.state.domain.resource.service;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.apache.commons.lang3.StringUtils;

/**
 * 资源导入归属校验器。
 *
 * <p>知识、工具、对象、视图导入都以 resourceCode 作为幂等键：同编码存在时会走覆盖更新。
 * 这里统一兜底校验已有资源 ownerType 与本次导入入口 ownerType 是否一致，避免用户在个人/企业
 * tab 之间误导入同编码资源，导致资源从一个归属域被覆盖到另一个归属域。</p>
 */
public final class ResourceImportOwnerTypeValidator {

    private ResourceImportOwnerTypeValidator() {
    }

    public static void validate(SsResource existing, String importOwnerType, String importResourceCode,
                                String importResourceName, String importResourceBizType) {
        if (existing == null) {
            return;
        }

        String existingOwnerType = StringUtils.trimToEmpty(existing.getOwnerType());
        String incomingOwnerType = StringUtils.trimToEmpty(importOwnerType);
        if (StringUtils.isAnyBlank(existingOwnerType, incomingOwnerType)
            || StringUtils.equals(existingOwnerType, incomingOwnerType)) {
            return;
        }

        String resourceCode = StringUtils.defaultIfBlank(importResourceCode, existing.getResourceCode());
        String resourceName = StringUtils.defaultIfBlank(existing.getResourceName(), importResourceName);
        resourceName = StringUtils.defaultIfBlank(resourceName, resourceCode);
        String ownerLabel = localizeOwnerType(existingOwnerType);
        String resourceLabel = localizeResourceType(StringUtils.defaultIfBlank(existing.getResourceBizType(),
            importResourceBizType));
        throw new IllegalArgumentException(I18nUtil.get("resource.import.owner.type.mismatch", resourceCode,
            resourceName, ownerLabel, resourceLabel));
    }

    private static String localizeOwnerType(String ownerType) {
        if (OwnerType.ENTERPRISE.equals(ownerType)) {
            return I18nUtil.get("resource.owner.type.enterprise");
        }
        if (OwnerType.PERSONAL.equals(ownerType) || OwnerType.PERSONAL_DEFAULT.equals(ownerType)) {
            return I18nUtil.get("resource.owner.type.personal");
        }
        return ownerType;
    }

    private static String localizeResourceType(String resourceBizType) {
        if (StringUtils.equalsAny(resourceBizType,
            ResourceBizType.KG_DOC.getCode(),
            ResourceBizType.KG_DB.getCode(),
            ResourceBizType.KG_TERM.getCode(),
            ResourceBizType.KG_QA.getCode())) {
            return I18nUtil.get("resource.label.knowledge");
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.OBJECT.getCode())) {
            return I18nUtil.get("resource.label.object");
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.VIEW.getCode())) {
            return I18nUtil.get("resource.label.view");
        }
        return I18nUtil.get("resource.label.tool");
    }
}
