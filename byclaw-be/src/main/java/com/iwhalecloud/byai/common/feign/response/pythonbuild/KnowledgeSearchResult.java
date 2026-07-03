package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.ArrayList;
import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 知识库 chunk 检索响应体。
 *
 * @author qin.guoquan
 * @date 2026-07-02 15:18:38
 */
@Getter
@Setter
public class KnowledgeSearchResult {

    private List<KnowledgeSearchItem> data = new ArrayList<>();
}
