package com.iwhalecloud.byai.common.constants.enterprise;

import java.util.Set;

/**
 * 企业租户成员角色。
 */
public final class TenantUserMembershipRole {

    private TenantUserMembershipRole() {
    }

    /**
     * 所有者
     */
    public static final String OWNER = "OWNER";

    /**
     * 管理员
     */
    public static final String ADMIN = "ADMIN";

    /**
     * 普通成员
     */
    public static final String MEMBER = "MEMBER";

    /**
     * 允许的角色集合
     */
    public static final Set<String> ALL = Set.of(OWNER, ADMIN, MEMBER);
}
