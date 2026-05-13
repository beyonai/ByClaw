package com.iwhalecloud.byai.state.domain.session.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TemplateSaveRequestDto implements Serializable {

    /**
     * 新模板会话ID，必传
     */
    private Long newSessionId;

    /**
     * 模板会话标题，可选 如果未提供则默认使用原会话标题
     */
    private String templateTitle;

    /**
     * 模板封面图片ID，必传
     */
    private Long coverId;

    /**
     * 终端类型:全端，PC端，APP端，
     */
    private String terminal;

    /**
     * 模板类型编码，必传 有效值：enterprise_qa、efficient_work、office_writing、market_analysis、data_analysis、research_report、other
     */
    private String templateType;

    /**
     * 做同款配置，可选 包含智能问答平台采购分析等配置信息
     */
    private String templateConfig;
}
