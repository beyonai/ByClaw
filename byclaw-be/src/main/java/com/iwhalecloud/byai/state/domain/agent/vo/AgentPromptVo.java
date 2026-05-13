package com.iwhalecloud.byai.state.domain.agent.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

/**
 * 智能体提示词生成响应
 */
@Data
@Schema(name = "AgentPromptVo", description = "智能体提示词生成响应")
public class AgentPromptVo {
    /**
     * 数字员工描述
     */
    @Schema(description = "智能体描述", example = "提供专业的投资理财建议")
    private String agentDescription;

    /**
     * 人设描述
     */
    @Schema(description = "人设描述", example = "专业的金融顾问，拥有10年投资经验")
    private String characterDescription;
    
    /**
     * 开场白
     */
    @Schema(description = "开场白", example = "您好！我是金融顾问，很高兴为您服务")
    private String openingRemark;
    
    /**
     * 常见问题
     */
    @Schema(description = "常见问题", example = "1. 如何选择投资产品？\n2. 当前市场趋势如何？")
    private List<String> commonQuestions;
    
    /**
     * 追问推荐提示词
     */
    @Schema(description = "追问推荐提示词", example = "您想了解：\n1. 股票投资\n2. 基金选择\n3. 风险管理")
    private String followupPrompts;
}
