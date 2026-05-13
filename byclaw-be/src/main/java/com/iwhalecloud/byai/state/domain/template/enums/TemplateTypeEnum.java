package com.iwhalecloud.byai.state.domain.template.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 模板类型枚举
 * 
 * <p>定义支持的模板类型及其显示名称。</p>
 * 
 * @author smartcloud
 * @version 1.0
 * @since 1.0
 */
@Getter
@AllArgsConstructor
public enum TemplateTypeEnum {
    
    /**
     * 企业问答
     */
    ENTERPRISE_QA("enterprise_qa", "企业问答"),
    
    /**
     * 高效办公
     */
    EFFICIENT_WORK("efficient_work", "高效办公"),
    
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
     * 研究报告
     */
    RESEARCH_REPORT("research_report", "研究报告"),
    
    /**
     * 其他
     */
    OTHER("other", "其他"),

    /**
     * 其他
     */
    ESG("esg", "ESG");


    /**
     * 模板类型编码
     */
    private final String code;
    
    /**
     * 模板类型显示名称
     */
    private final String displayName;
    
    /**
     * 根据编码获取枚举
     * 
     * @param code 模板类型编码
     * @return 对应的枚举，如果不存在则返回null
     */
    public static TemplateTypeEnum fromCode(String code) {
        if (code == null || code.trim().isEmpty()) {
            return null;
        }
        
        for (TemplateTypeEnum type : values()) {
            if (type.getCode().equals(code.trim())) {
                return type;
            }
        }
        return null;
    }
    
    /**
     * 验证模板类型编码是否有效
     * 
     * @param code 模板类型编码
     * @return 是否有效
     */
    public static boolean isValid(String code) {
        return fromCode(code) != null;
    }
    
    /**
     * 获取所有有效的模板类型编码
     * 
     * @return 所有有效的模板类型编码数组
     */
    public static String[] getAllCodes() {
        TemplateTypeEnum[] values = values();
        String[] codes = new String[values.length];
        for (int i = 0; i < values.length; i++) {
            codes[i] = values[i].getCode();
        }
        return codes;
    }
    
    /**
     * 获取所有有效的模板类型编码（逗号分隔的字符串）
     * 
     * @return 所有有效的模板类型编码字符串
     */
    public static String getAllCodesAsString() {
        return String.join(",", getAllCodes());
    }
}
