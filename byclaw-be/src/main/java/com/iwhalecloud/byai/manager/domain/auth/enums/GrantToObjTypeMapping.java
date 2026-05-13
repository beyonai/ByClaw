package com.iwhalecloud.byai.manager.domain.auth.enums;

/**
 * 授权对象类型映射枚举
 * 用于将内部授权对象类型转换为外部系统需要的类型
 * 
 * @author system
 * @date 2025-01-27
 */
public enum GrantToObjTypeMapping {
    
    USER(GrantToObjType.USER, "PERSON", "人员"),
    ORG(GrantToObjType.ORG, "ORGANIZATION", "组织"),
    POST(GrantToObjType.POST, "POSITION", "岗位"),
    ROLE(GrantToObjType.ROLE, "ROLE", "角色"),
    STATION(GrantToObjType.STATION, "STATION", "驻地");

    private final String sourceType;
    private final String targetType;
    private final String description;

    GrantToObjTypeMapping(String sourceType, String targetType, String description) {
        this.sourceType = sourceType;
        this.targetType = targetType;
        this.description = description;
    }

    /**
     * 根据源类型获取目标类型
     * 
     * @param sourceType 源类型
     * @return 目标类型，如果未找到则返回原值
     */
    public static String getTargetType(String sourceType) {
        if (sourceType == null) {
            return null;
        }
        
        for (GrantToObjTypeMapping mapping : values()) {
            if (mapping.sourceType.equalsIgnoreCase(sourceType)) {
                return mapping.targetType;
            }
        }
        return null;
    }

    /**
     * 根据目标类型获取源类型
     * 
     * @param targetType 目标类型
     * @return 源类型，如果未找到则返回null
     */
    public static String getSourceType(String targetType) {
        if (targetType == null) {
            return null;
        }
        
        for (GrantToObjTypeMapping mapping : values()) {
            if (mapping.targetType.equalsIgnoreCase(targetType)) {
                return mapping.sourceType;
            }
        }
        return null;
    }

    /**
     * 检查是否支持该源类型
     * 
     * @param sourceType 源类型
     * @return 是否支持
     */
    public static boolean isSupported(String sourceType) {
        if (sourceType == null) {
            return false;
        }
        
        for (GrantToObjTypeMapping mapping : values()) {
            if (mapping.sourceType.equalsIgnoreCase(sourceType)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 获取类型描述
     * 
     * @param sourceType 源类型
     * @return 描述信息
     */
    public static String getDescription(String sourceType) {
        if (sourceType == null) {
            return null;
        }
        
        for (GrantToObjTypeMapping mapping : values()) {
            if (mapping.sourceType.equalsIgnoreCase(sourceType)) {
                return mapping.description;
            }
        }
        return null;
    }
}
