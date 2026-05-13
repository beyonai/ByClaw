package com.iwhalecloud.byai.manager.dto.digitemploy;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 智能体提示词生成请求
 */
@Getter
@Setter
public class AgentPromptDto {

    /**
     * 数字员工名称
     */
    private String agentName;

    /**
     * 数字员工描述
     */
    private String agentDescription;

    /**
     * 常见问题
     */
    private String commonQuestions;

    /**
     * 能力说明
     */
    private String ability;

    /**
     * 约束条件
     */
    private String constraints;

    /**
     * 常见问题解答
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
     * 人格维度
     */
    private String personalityDimensions;

    /**
     * 用词偏好
     */
    private String wordPreferences;

    /**
     * 句式与语气要求
     */
    private String sentenceAndTone;

    /**
     * 核心能力
     */
    private String coreCompetencies;

    /**
     * 关联资源信息
     */
    private List<Long> relIds;

    /**
     * 语言
     */
    private String language = "zh-CN";
}
