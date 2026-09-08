package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import lombok.Getter;
import lombok.Setter;

/**
 * QA 知识实体发现请求，对应 POST /api/v1/knowledgeItems/entityDiscovery。
 *
 * @author qin.guoquan
 * @date 2026-08-19 16:25:38
 */

@Getter
@Setter
public class KbEntityDiscovery {

    private String knCode;

    private String filePath;

    /**
     * 原始文档目录，递归处理子目录；未传 filePath 时生效
     */
    private String directoryPath;

    private Integer maxEntities;

    private Boolean force;

    /**
     * 追加到本次 Discovery 实际创建或锚定到的 KnowledgeEntity metadata。
     */
    private List<String> tags;

    private Map<String, Object> extraParams = new LinkedHashMap<>();
}
