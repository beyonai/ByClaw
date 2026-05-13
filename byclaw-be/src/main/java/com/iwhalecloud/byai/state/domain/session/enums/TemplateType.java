package com.iwhalecloud.byai.state.domain.session.enums;

/**
 * 模板类型枚举
 * 
 * @author smartcloud
 */
public enum TemplateType {
    
    /**
     * 企业问答
     */
    ENTERPRISE_QA("enterprise_qa", "企业问答"),
    
    /**
     * 高效工作
     */
    EFFICIENT_WORK("efficient_work", "高效工作"),
    
    /**
     * 办公写作
     */
    OFFICE_WRITING("office_writing", "办公写作"),
    
    /**
     * 市场分析
     */
    MARKET_ANALYSIS("market_analysis", "市场分析"),
    
    /**
     * 数据分析
     */
    DATA_ANALYSIS("data_analysis", "数据分析"),
    
    /**
     * 调研报告
     */
    RESEARCH_REPORT("research_report", "调研报告"),
    
    /**
     * 其他
     */
    OTHER("other", "其他"),

    /**
     * ESG
     */
    ESG("esg", "ESG");


    private final String code;
    private final String displayName;
    
    TemplateType(String code, String displayName) {
        this.code = code;
        this.displayName = displayName;
    }
    
    /**
     * 获取编码
     */
    public String getCode() {
        return code;
    }
    
    /**
     * 获取显示名称
     */
    public String getDisplayName() {
        return displayName;
    }
    
    /**
     * 根据编码获取枚举
     */
    public static TemplateType fromCode(String code) {
        if (code == null || code.trim().isEmpty()) {
            return null;
        }
        
        for (TemplateType type : values()) {
            if (type.code.equals(code.trim())) {
                return type;
            }
        }
        return null;
    }
    
    /**
     * 根据显示名称获取枚举
     */
    public static TemplateType fromDisplayName(String displayName) {
        if (displayName == null || displayName.trim().isEmpty()) {
            return null;
        }
        
        for (TemplateType type : values()) {
            if (type.displayName.equals(displayName.trim())) {
                return type;
            }
        }
        return null;
    }
    
    /**
     * 根据编码或显示名称获取枚举
     */
    public static TemplateType fromCodeOrDisplayName(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        
        // 先尝试按编码查找
        TemplateType byCode = fromCode(value);
        if (byCode != null) {
            return byCode;
        }
        
        // 再尝试按显示名称查找
        return fromDisplayName(value);
    }
    
    /**
     * 获取所有编码
     */
    public static String[] getAllCodes() {
        TemplateType[] types = values();
        String[] codes = new String[types.length];
        for (int i = 0; i < types.length; i++) {
            codes[i] = types[i].code;
        }
        return codes;
    }
    
    /**
     * 获取所有显示名称
     */
    public static String[] getAllDisplayNames() {
        TemplateType[] types = values();
        String[] displayNames = new String[types.length];
        for (int i = 0; i < types.length; i++) {
            displayNames[i] = types[i].displayName;
        }
        return displayNames;
    }
    
    /**
     * 验证编码是否有效
     */
    public static boolean isValidCode(String code) {
        return fromCode(code) != null;
    }
    
    /**
     * 验证显示名称是否有效
     */
    public static boolean isValidDisplayName(String displayName) {
        return fromDisplayName(displayName) != null;
    }
    
    /**
     * 验证编码或显示名称是否有效
     */
    public static boolean isValidCodeOrDisplayName(String value) {
        return fromCodeOrDisplayName(value) != null;
    }
}
