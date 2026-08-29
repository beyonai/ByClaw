package com.iwhalecloud.byai.common.feign.request.datacloud;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * 提交工作区模板请求（POST /api/v1/ontology-manager/workspace/templates/submit）。
 */
@Getter
@Setter
public class SubmitWorkspaceTemplateReq {

    @JsonProperty("is_personal")
    @JSONField(name = "is_personal")
    private boolean isPersonal;

    @JsonProperty("is_sqlite")
    @JSONField(name = "is_sqlite")
    private boolean isSqlite;

    @JsonProperty("reuse_target_tables")
    @JSONField(name = "reuse_target_tables")
    private boolean reuseTargetTables;

    @JsonProperty("confirm_drop_target_tables")
    @JSONField(name = "confirm_drop_target_tables")
    private boolean confirmDropTargetTables;
}
