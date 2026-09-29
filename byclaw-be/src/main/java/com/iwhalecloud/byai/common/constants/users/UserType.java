package com.iwhalecloud.byai.common.constants.users;

/***
 * 用户角色,ORD_USER:普通用户,ORG_MAN:组织管理,PLAT_MAN:平台管理,PLAT_DEVOPS:平台运维'
 */
public final class UserType {

    /** 仅在权限比较时忽略大小写，保留规范角色编码及原始数据。 */
    public static boolean matchesAny(String userType, String... allowedTypes) {
        if (userType == null) {
            return false;
        }
        for (String allowedType : allowedTypes) {
            if (allowedType != null && allowedType.equalsIgnoreCase(userType)) {
                return true;
            }
        }
        return false;
    }

    private UserType() {
    }

    /**
     * 平台管理
     */
    public static final String PLAT_MAN = "PLAT_MAN";

    /**
     * 组织管理
     */
    public static final String ORG_MAN = "ORG_MAN";

    /**
     * 平台运维
     */
    public static final String PLAT_DEVOPS = "PLAT_DEVOPS";

    /**
     * 业务管理
     */
    public static final String BUSINESS_MAN = "BUSINESS_MAN";

    /**
     * 普通用户
     */
    public static final String ORD_USER = "ORD_USER";

}
