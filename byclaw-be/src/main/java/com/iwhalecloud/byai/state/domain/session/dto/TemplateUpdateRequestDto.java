package com.iwhalecloud.byai.state.domain.session.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 更新模板会话参数请求DTO
 *
 * @author smartcloud
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TemplateUpdateRequestDto implements Serializable {

    /**
     * 模板会话标题，可选 仅当提供时才更新
     */
    private String templateTitle;

    /**
     * 模板封面图片ID，可选 仅当提供时才更新
     */
    private Long coverId;

    /**
     * 终端类型:全端，PC端，APP端，
     */
    private String terminal;

    /**
     * 模板类型编码，可选 有效值：enterprise_qa、efficient_work、office_writing、market_analysis、data_analysis、research_report、other
     * 仅当提供时才更新
     */
    private String templateType;

    /**
     * 做同款配置，可选 包含智能问答平台采购分析等配置信息
     */
    private String templateConfig;
}
