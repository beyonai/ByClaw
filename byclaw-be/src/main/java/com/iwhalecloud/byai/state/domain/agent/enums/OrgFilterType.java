package com.iwhalecloud.byai.state.domain.agent.enums;

/**
 * @author he.duming
 * @date 2025-11-11 20:21:08
 * @description TODO
 */
public final class OrgFilterType {

    private OrgFilterType() {
    }

    /**
     * 全部（包含全部场景）
     */
    public static final String ALL = "ALL";

    /**
     * 公司范围（全公司员工可访问）
     */
    public static final String COMPANY = "COMPANY";

    /**
     * 部门范围（当前用户所属及相关部门可访问）
     */
    public static final String DEPT = "DEPT";

    /**
     * 自定义范围（支持用户自主选择特定组织 / 人员范围）
     */
    public static final String CUSTOM = "CUSTOM";

}
