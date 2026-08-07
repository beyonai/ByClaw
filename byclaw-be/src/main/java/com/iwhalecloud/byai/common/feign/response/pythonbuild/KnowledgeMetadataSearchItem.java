package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * 纯元数据检索文件项。
 *
 * @author qin.guoquan
 * @date 2026-08-06 10:38:38
 */
@Getter
@Setter
public class KnowledgeMetadataSearchItem {

    /** QA 知识库编码。 */
    private String knCode;

    /** 门户知识库资源 ID，由 Controller 根据 knCode 回映。 */
    private Long resourceId;

    private String filePath;

    private Map<String, Object> metadata = new LinkedHashMap<>();
}
