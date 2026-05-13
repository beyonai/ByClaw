package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 上传文档（multipart）表单字段模型，对应 docs/api/api.md {@code POST /api/v1/knowledgeItems/import}。
 */
@Getter
@Setter
public class KbFileDownload {

    /** 知识库编码，必填 */
    private String knCode;

    /**
     * 需下载的文件全路径，以 / 开头，不包括知识库名称
     */
    private String filePath;

}
