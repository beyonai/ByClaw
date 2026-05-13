package com.iwhalecloud.byai.manager.vo.resource;

import lombok.Data;

import java.util.List;

/**
 * 智能体提示词生成响应
 */
@Data
public class AgentPromptVo {
    /**
     * 数字员工描述
     */
    private String agentDescription;

    /**
     * 人设描述
     */
    private String characterDescription;

    /**
     * 开场白
     */
    private String openingRemark;

    /**
     * 常见问题
     */
    private List<String> commonQuestions;

    /**
     * 追问推荐提示词
     */
    private String followupPrompts;

    /**
     * 智能体标签
     */
    private String agentTags;

    /**
     * 核心能力
     */
    private String ability;

    /**
     * 能力边界
     */
    private String constraints;

    /**
     * 示例问法
     */
    private String faqs;

    /**
     * 角色属性
     */
    private String roleAttributes;

    /**
     * 处理流程
     */
    private String processingFlow;

    /**
     * 性格维度
     */
    private String personalityDimensions;

    /**
     * 用词偏好
     */
    private String wordPreferences;

    /**
     * 句式和语气
     */
    private String sentenceAndTone;

}
