package com.iwhalecloud.byai.state.domain.chat.dto;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Data;

import java.util.Map;

/**
 * 智能体卡片数据传输对象
 * 
 * @author AI Assistant
 * @date 2025-09-11
 */
@Data
public class AgentCardDto {

    /**
     * 智能体ID
     */
    @JSONField(name = "agentId")
    private Long agentId;

    /**
     * 智能体类型
     */
    @JSONField(name = "agentType")
    private String agentType;

    /**
     * 智能体名称
     */
    @JSONField(name = "agentName")
    private String agentName;

    /**
     * 智能体描述
     */
    @JSONField(name = "agentDescription")
    private String agentDescription;

    /**
     * 创建类型
     */
    @JSONField(name = "createType")
    private String createType;

    /**
     * 参数信息，包含input等参数
     */
    @JSONField(name = "args")
    private Map<String, Object> args;

    /**
     * 动态智能体卡片功能标识
     */
    @JSONField(name = "dynamic_agent_card_func")
    private Boolean dynamicAgentCardFunc;

    /**
     * 任务id
     */
    private String taskId;

    /**
     * 是否覆盖
     */
    private Boolean recover;


    @Override
    public String toString() {
        return "AgentCardDto{" +
                "agentId=" + agentId +
                ", agentType='" + agentType + '\'' +
                ", agentName='" + agentName + '\'' +
                ", agentDescription='" + agentDescription + '\'' +
                ", createType='" + createType + '\'' +
                ", args=" + args +
                ", dynamicAgentCardFunc=" + dynamicAgentCardFunc +
                ", dynamicAgentCardFunc=" + dynamicAgentCardFunc +
                ", taskId='" + taskId + '\'' +
                '}';
    }
}
