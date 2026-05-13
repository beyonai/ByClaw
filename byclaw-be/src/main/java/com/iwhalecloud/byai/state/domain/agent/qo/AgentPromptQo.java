package com.iwhalecloud.byai.state.domain.agent.qo;

import com.iwhalecloud.byai.state.common.enums.OptimizeTypeEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 智能体提示词生成请求
 */
@Data
@Schema(name = "AgentPromptQo", description = "智能体提示词生成请求")
public class AgentPromptQo {
    /**
     * 数字员工名称
     */
    @NotBlank(message = "{agentpromptqo.agentname.notempty}")
    @Schema(description = "智能体名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "金融顾问")
    private String agentName;

    /**
     * 数字员工描述
     */
    @NotBlank(message = "{agentpromptqo.agentdescription.notempty}")
    @Schema(description = "智能体描述", requiredMode = Schema.RequiredMode.REQUIRED, example = "提供专业的投资理财建议")
    private String agentDescription;

    /**
     * 人设
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
    private String commonQuestions;

    /**
     * 推荐提示词
     */
    @Schema(description = "追问推荐提示词", example = "您想了解：\n1. 股票投资\n2. 极简风格优化说明基金选择\n3. 风险管理")
    private String followupPrompts;

    /**
     * 优化类型
     */
    @Schema(description = "优化类型", example = "AGENT_NAME", allowableValues = {
        "AGENT_NAME", "AGENT_DESCRIPTION", "CHARACTER_DESCRIPTION", "OPENING_REMARKS", "COMMON_PROBLEM",
        "RECOMMENDED_QUESTION"
    })
    private OptimizeTypeEnum optimizeType;

    /**
     * 语言
     */
    @Schema(description = "语言代码", example = "zh", defaultValue = "zh", allowableValues = {
        "zh", "en"
    })
    private String lang = "zh";
}
