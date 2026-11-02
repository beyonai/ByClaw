package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/** 批量知识库统计请求，仅向 QA 发送 knCodeList。 @author Codex @since 2026-11-02 */
@Getter
@Setter
public class KbKnowledgeStatus {
    private List<String> knCodeList;

    /** 同一端点内批量查询，首个编码仅供既有服务路由解析，不进入请求体。 */
    @JsonIgnore
    @JSONField(serialize = false)
    public String getKnCode() {
        return knCodeList == null || knCodeList.isEmpty() ? null : knCodeList.get(0);
    }
}
