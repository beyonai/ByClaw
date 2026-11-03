package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/** 批量知识库统计请求，支持按完整路径前缀排除内容。 @author Codex @since 2026-11-02 */
@Getter
@Setter
public class KbKnowledgeStatus {
    private List<String> knCodeList;

    /** 可选排除前缀；未设置时不发送该字段，保留容量统计等调用方的全库口径。 */
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    private List<String> excludePathPrefixList;

    /** 同一端点内批量查询，首个编码仅供既有服务路由解析，不进入请求体。 */
    @JsonIgnore
    @JSONField(serialize = false)
    public String getKnCode() {
        return knCodeList == null || knCodeList.isEmpty() ? null : knCodeList.get(0);
    }
}
