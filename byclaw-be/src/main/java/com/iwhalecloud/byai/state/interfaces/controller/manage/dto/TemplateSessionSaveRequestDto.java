package com.iwhalecloud.byai.state.interfaces.controller.manage.dto;

import com.iwhalecloud.byai.state.domain.template.enums.TemplateTypeEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;
import java.io.Serializable;
import java.util.List;

/**
 * 模板会话保存请求DTO
 * <p>
 * 支持文件上传，自动转换为base64字符串。
 * </p>
 * 
 * @author smartcloud
 * @version 1.0
 * @since 1.0
 */
@Data
@Schema(description = "模板会话保存请求")
public class TemplateSessionSaveRequestDto implements Serializable {

    @Schema(description = "会话ID", example = "1234567890", required = true)
    private Long sessionId;

    @Size(max = 100, message = "模板标题长度不能超过100个字符")
    @Schema(description = "模板标题", example = "企业问答模板", required = true)
    private String templateTitle;

    /**
     * 模板图片文件 支持格式：jpg, jpeg, png, gif 最大大小：5MB
     */
    @Schema(description = "封面ID", example = "image.png")
    private Long coverId;

    /**
     * 模板类型编码
     */
    @Pattern(
        regexp = "^(enterprise_qa|efficient_work|office_writing|market_analysis|data_analysis|research_report|other|esg)$",
        message = "模板类型不合法，支持的类型：enterprise_qa, efficient_work, office_writing, market_analysis, data_analysis, research_report, other, esg")
    @Schema(description = "模板类型", example = "enterprise_qa", required = true, allowableValues = {
        "enterprise_qa", "efficient_work", "office_writing", "market_analysis", "data_analysis", "research_report",
        "other", "esg"
    })
    private String templateType;

    /**
     * 终端类型:全端，PC端，APP端，
     */
    private String terminal;

    /**
     * 指定的消息ID列表，可选 如果提供，则只复制指定的消息 如果不提供或为空，则复制原会话的所有消息
     */
    @Schema(description = "指定的消息ID列表，可选。如果提供，则只复制指定的消息；如果不提供或为空，则复制原会话的所有消息", example = "[123456, 789012]")
    private List<Long> messageIds;

    /**
     * 做同款配置，可选 包含智能问答平台采购分析等配置信息，前端传入为JSON字符串格式
     */
    @Schema(description = "做同款配置，可选。包含智能问答平台采购分析等配置信息，前端传入为JSON字符串格式",
        example = "{\"analysisType\":\"purchase\",\"platform\":\"intelligent_qa\"}")
    private String templateConfig;

    /**
     * 获取模板类型的显示名称
     * 
     * @return 模板类型显示名称
     */
    public String getTemplateTypeName() {
        TemplateTypeEnum typeEnum = TemplateTypeEnum.fromCode(this.templateType);
        return typeEnum != null ? typeEnum.getDisplayName() : null;
    }

    /**
     * 验证模板类型是否有效
     * 
     * @return 是否有效
     */
    public boolean isValidTemplateType() {
        return TemplateTypeEnum.isValid(this.templateType);
    }
}
