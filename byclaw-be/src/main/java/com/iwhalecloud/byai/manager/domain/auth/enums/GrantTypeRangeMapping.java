package com.iwhalecloud.byai.manager.domain.auth.enums;

/**
 * 授权类型到范围标识的映射枚举
 * 用于构建权限授权Key中的range部分
 * 
 * @author system
 * @date 2025-01-27
 */
public enum GrantTypeRangeMapping {
    
    AVAILABLE_USE(GrantType.AVAILABLE_USE, "1", "使用授权"),
    FORCE_USE(GrantType.FORCE_USE, "2", "强制使用"),
    ALLOW_MANAGE(GrantType.ALLOW_MANAGE, "3", "管理授权"),
    SHARE_USE(GrantType.SHARE_USE, "4", "分享授权"),
    OWNER(GrantType.OWNER, "5", "归属授权");

    private final String grantType;
    private final String range;
    private final String description;

    GrantTypeRangeMapping(String grantType, String range, String description) {
        this.grantType = grantType;
        this.range = range;
        this.description = description;
    }

    /**
     * 根据授权类型获取范围标识
     * 
     * @param grantType 授权类型
     * @return 范围标识，如果未找到则返回默认值"1"
     */
    public static String getRange(String grantType) {
        if (grantType == null) {
            return "1"; // 默认使用权限
        }
        
        for (GrantTypeRangeMapping mapping : values()) {
            if (mapping.grantType.equals(grantType)) {
                return mapping.range;
            }
        }
        return "1"; // 默认使用权限
    }

    /**
     * 根据范围标识获取授权类型
     * 
     * @param range 范围标识
     * @return 授权类型，如果未找到则返回null
     */
    public static String getGrantType(String range) {
        if (range == null) {
            return null;
        }
        
        for (GrantTypeRangeMapping mapping : values()) {
            if (mapping.range.equals(range)) {
                return mapping.grantType;
            }
        }
        return null;
    }

    /**
     * 检查是否支持该授权类型
     * 
     * @param grantType 授权类型
     * @return 是否支持
     */
    public static boolean isSupported(String grantType) {
        if (grantType == null) {
            return false;
        }
        
        for (GrantTypeRangeMapping mapping : values()) {
            if (mapping.grantType.equals(grantType)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 获取授权类型描述
     * 
     * @param grantType 授权类型
     * @return 描述信息
     */
    public static String getDescription(String grantType) {
        if (grantType == null) {
            return null;
        }
        
        for (GrantTypeRangeMapping mapping : values()) {
            if (mapping.grantType.equals(grantType)) {
                return mapping.description;
            }
        }
        return null;
    }
}
