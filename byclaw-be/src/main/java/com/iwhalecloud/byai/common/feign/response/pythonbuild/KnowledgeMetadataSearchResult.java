package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 纯元数据检索分页结果。
 *
 * @author qin.guoquan
 * @date 2026-08-06 10:38:38
 */
@Getter
@Setter
public class KnowledgeMetadataSearchResult {

    private List<KnowledgeMetadataSearchItem> data = new ArrayList<>();

    private Long total;

    private Integer pageNum;

    private Integer pageSize;
}
