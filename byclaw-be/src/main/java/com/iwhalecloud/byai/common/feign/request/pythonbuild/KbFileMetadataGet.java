package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 查询知识库文件元数据，对应 {@code POST /api/v1/knowledgeItems/metadata/get}。
 */
@Getter
@Setter
public class KbFileMetadataGet {

    /** 知识库编码，必填。 */
    private String knCode;

    /** 知识库内文件完整路径，以 {@code /} 开头，必填。 */
    private String filePath;

    /** 要返回的元数据字段；不传时由 QA 返回文件全部元数据。 */
    private List<String> metadataFieldList;
}
