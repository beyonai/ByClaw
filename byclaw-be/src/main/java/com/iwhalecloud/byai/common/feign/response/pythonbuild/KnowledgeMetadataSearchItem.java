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

    /** 经门户封装后返回 ByClaw resourceId。 */
    private String knCode;

    private String filePath;

    private Map<String, Object> metadata = new LinkedHashMap<>();
}
