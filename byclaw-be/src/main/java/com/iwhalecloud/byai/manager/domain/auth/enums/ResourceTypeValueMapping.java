package com.iwhalecloud.byai.manager.domain.auth.enums;

import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;

/**
 * 资源类型到Value前缀的映射枚举 用于构建权限授权Value：{RESOURCE_TYPE}_{resourceId}
 *
 * @author system
 * @date 2025-01-27
 */
public enum ResourceTypeValueMapping {

    // 数字员工资源
    DIG_EMPLOYEE(ResourceBizTypeEnum.DIG_EMPLOYEE.name(), "DIG_EMPLOYEE"),

    // 文档库资源
    KG_DOC(ResourceBizTypeEnum.KG_DOC.name(), "KG_DOC"),

    // 问答库资源
    KG_QA(ResourceBizTypeEnum.KG_QA.name(), "KG_QA"),

    // 术语库资源
    KG_TERM(ResourceBizTypeEnum.KG_TERM.name(), "KG_TERM"),

    // 数据库知识库资源
    KG_DB(ResourceBizTypeEnum.KG_DB.name(), "KG_DB"),

    // 智能体资源
    AGENT(ResourceBizTypeEnum.AGENT.name(), "AGENT"),

    // 资源目录
    CATALOGUE("CATALOGUE", "CATALOGUE"),

    // MCP 服务资源
    MCP(ResourceBizTypeEnum.MCP.name(), "MCP"),

    // 工具资源
    TOOL(ResourceBizTypeEnum.TOOL.name(), "TOOL"),

    // 插件包资源
    TOOLKIT(ResourceBizTypeEnum.TOOLKIT.name(), "TOOLKIT"),

    // MCP 工具资源
    MCP_TOOL(ResourceBizTypeEnum.MCP_TOOL.name(), "MCP_TOOL"),

    // 标签资源
    TAG(ResourceBizTypeEnum.TAG.name(), "TAG"),

    // 对象资源
    OBJECT(ResourceBizTypeEnum.OBJECT.name(), "OBJECT"),

    // 视图资源
    VIEW(ResourceBizTypeEnum.VIEW.name(), "VIEW"),

    // 动作资源
    ACTION(ResourceBizTypeEnum.ACTION.name(), "ACTION"),

    // 管理用户资源
    MAN_USER(ResourceBizTypeEnum.MAN_USER.name(), "MAN_USER"),

    // 管理组织资源
    MAN_ORG(ResourceBizTypeEnum.MAN_ORG.name(), "MAN_ORG");

    private final String resourceType;

    private final String valuePrefix;

    ResourceTypeValueMapping(String resourceType, String valuePrefix) {
        this.resourceType = resourceType;
        this.valuePrefix = valuePrefix;
    }

    /**
     * 根据资源类型获取Value前缀
     *
     * @param resourceType 资源类型
     * @return Value前缀，如果未找到则返回原值
     */
    public static String getValuePrefix(String resourceType) {
        if (resourceType == null) {
            return null;
        }

        for (ResourceTypeValueMapping mapping : values()) {
            if (mapping.resourceType.equalsIgnoreCase(resourceType)) {
                return mapping.valuePrefix;
            }
        }
        return resourceType; // 默认返回原值
    }

    /**
     * 检查是否支持该资源类型
     *
     * @param resourceType 资源类型
     * @return 是否支持
     */
    public static boolean isSupported(String resourceType) {
        if (resourceType == null) {
            return false;
        }

        for (ResourceTypeValueMapping mapping : values()) {
            if (mapping.resourceType.equalsIgnoreCase(resourceType)) {
                return true;
            }
        }
        return false;
    }
}
