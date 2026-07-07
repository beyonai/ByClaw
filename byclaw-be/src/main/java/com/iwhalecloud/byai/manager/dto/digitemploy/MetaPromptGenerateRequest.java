package com.iwhalecloud.byai.manager.dto.digitemploy;

import lombok.Data;

import java.util.List;

@Data
public class MetaPromptGenerateRequest {

    private String description;

    private String agentName;
    private String agentDescription;
    private String characterDescription;
    private String openingRemark;
    private String commonQuestions;
    private String constraints;
    private String faqs;
    private String roleAttributes;
    private String processingFlow;
    private String personalityDimensions;
    private String wordPreferences;
    private String sentenceAndTone;
    private String corePersonaDefinition;

    private List<String> relIds;
    private String OptimizeTypeEnum;

    private String agentType;
    private String lang;
    private String language;
    private String modelCode;
    private Long resourceId;

    public String resolvedLang() {
        if (lang != null && !lang.isBlank()) {
            return lang.startsWith("zh") ? "zh" : "en";
        }
        if (language != null && !language.isBlank()) {
            return language.startsWith("zh") ? "zh" : "en";
        }
        return "zh";
    }

    public String resolvedDescription() {
        if (description != null && !description.isBlank()) {
            return description;
        }
        StringBuilder sb = new StringBuilder();
        appendField(sb, "智能体名称", agentName);
        appendField(sb, "智能体描述", agentDescription);
        appendField(sb, "角色定义", characterDescription);
        appendField(sb, "开场白", openingRemark);
        appendField(sb, "常见问题", commonQuestions);
        appendField(sb, "能力边界", constraints);
        appendField(sb, "示例问法", faqs);
        appendField(sb, "角色属性", roleAttributes);
        appendField(sb, "处理流程", processingFlow);
        appendField(sb, "性格维度", personalityDimensions);
        appendField(sb, "用词偏好", wordPreferences);
        appendField(sb, "句式语气", sentenceAndTone);
        appendField(sb, "已有核心人格定义", corePersonaDefinition);
        return sb.length() > 0 ? sb.toString() : agentName != null ? agentName : "";
    }

    private static void appendField(StringBuilder sb, String label, String value) {
        if (value != null && !value.isBlank()) {
            sb.append(label).append(": ").append(value).append("\n");
        }
    }
}
