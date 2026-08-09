package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * 文件级语义检索结果项。
 *
 * @author qin.guoquan
 * @date 2026-7-13 17:38:38
 */
@Getter
@Setter
public class KnowledgeFileSearchItem {

    /** QA 知识库编码。 */
    private String knCode;

    /** 门户知识库资源 ID，由 Controller 根据 knCode 回映。 */
    private Long resourceId;

    private String filePath;

    /** 服务端聚合后的文件级排序分值。 */
    private Double score;

    /** 按 metadataFieldList 返回的元数据，valueType/value 结构由 QA 定义。 */
    private Map<String, Object> metadata = new LinkedHashMap<>();
}
