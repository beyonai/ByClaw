package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * QA 文件元数据查询结果。
 */
@Getter
@Setter
public class KbFileMetadataResult {

    private Map<String, MetadataValue> metadata = new LinkedHashMap<>();

    @Getter
    @Setter
    public static class MetadataValue {

        private String valueType;

        private Object value;
    }
}
