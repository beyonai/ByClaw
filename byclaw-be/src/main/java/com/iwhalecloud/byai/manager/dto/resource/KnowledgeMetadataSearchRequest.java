package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * 门户 Agent DSL 纯元数据检索请求。
 * 门户接收知识库资源 ID，校验访问权限后转换为 QA knCode。
 *
 * @author qin.guoquan
 * @date 2026-08-06 10:38:38
 */
@Getter
@Setter
public class KnowledgeMetadataSearchRequest {

    @NotEmpty(message = "{dataset.metadata.search.resource.id.list.notempty}")
    private List<@NotNull(message = "{dataset.metadata.search.resource.id.notnull}") Long> resourceIdList = new ArrayList<>();

    @NotNull(message = "{dataset.metadata.search.where.notnull}")
    private Map<String, Object> where;

    private List<String> metadataFieldList = new ArrayList<>();

    @Positive(message = "{dataset.metadata.search.topk.positive}")
    @Max(value = 10000, message = "{dataset.metadata.search.topk.max}")
    private Integer topK;

    @Positive(message = "{dataset.metadata.search.page.num.positive}")
    private Integer pageNum;

    @Positive(message = "{dataset.metadata.search.page.size.positive}")
    @Max(value = 10000, message = "{dataset.metadata.search.page.size.max}")
    private Integer pageSize;
}
