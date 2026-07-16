package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * Agent DSL 文件级语义检索响应。
 *
 * @author qin.guoquan
 * @date 2026-7-13 17:38:38
 */
@Getter
@Setter
public class KnowledgeFileSearchResult {

    private List<KnowledgeFileSearchItem> data = new ArrayList<>();
}
