package com.iwhalecloud.byai.common.constants.devloop;

import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import org.apache.commons.lang3.StringUtils;

/**
 * 项目绑定资源类型，与前端 {@code ProjectResourceType} 保持一致。
 */
public final class ProjectResourceType {

    public static final String KNOWLEDGE = "knowledge";
    public static final String DIGITAL_EMPLOYEE = "digital_employee";
    public static final String ONTOLOGY = "ontology";

    private ProjectResourceType() {
    }

    /**
     * 根据平台资源业务类型映射为项目绑定资源类型。
     *
     * @param resourceBizType 平台资源业务类型编码
     * @return 项目资源类型，无法识别时返回 null
     */
    public static String fromResourceBizType(String resourceBizType) {
        if (StringUtils.isBlank(resourceBizType)) {
            return null;
        }
        ResourceBizType bizType = ResourceBizType.getByCode(resourceBizType);
        if (bizType == null) {
            return null;
        }
        return switch (bizType) {
            case KG_DOC, KG_DB, KG_TERM, KG_QA -> KNOWLEDGE;
            case DIG_EMPLOYEE -> DIGITAL_EMPLOYEE;
            case VIEW, OBJECT, ONTOLOGY_BASE -> ONTOLOGY;
            default -> null;
        };
    }
}
