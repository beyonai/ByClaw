package com.iwhalecloud.byai.common.constants.resource;

/**
 * @author he.duming
 * @date 2026-04-14 19:37:37
 * @description 资源归属类型：enterprise-企业，personal-个人
 */
public final class OwnerType {

    private OwnerType() {
    }

    /**
     * 企业资源
     */
    public static final String PERSONAL = "personal";

    /**
     * 个人资源
     */
    public static final String ENTERPRISE = "enterprise";

    /**
     * 默认资源(默认知识库,默认数字员工)
     */
    public static final String PERSONAL_DEFAULT = "personal_default";
}
