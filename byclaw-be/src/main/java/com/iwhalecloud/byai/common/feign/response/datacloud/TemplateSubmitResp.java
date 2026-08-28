package com.iwhalecloud.byai.common.feign.response.datacloud;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 提交工作区模板响应 data（POST /api/v1/ontology-manager/workspace/templates/submit）。
 */
@Getter
@Setter
public class TemplateSubmitResp {

    /** 是否 SQLite 模式 */
    @JsonProperty("is_sqlite")
    @JSONField(name = "is_sqlite")
    private Boolean sqlite;

    /** 模板目录 */
    @JsonProperty("template_directory")
    @JSONField(name = "template_directory")
    private String templateDirectory;

    /** 提交模板总数 */
    private Integer total;

    /** 失败数量 */
    private Integer failed;

    /** 整体是否成功 */
    private Boolean ok;

    /** 各模板提交明细 */
    private List<TemplateSubmitResult> results;

    /** 是否个人工作区 */
    @JsonProperty("is_personal")
    @JSONField(name = "is_personal")
    private Boolean personal;

    /** 成功数量 */
    private Integer succeeded;
}
