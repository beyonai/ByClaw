package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;
import org.springframework.web.multipart.MultipartFile;

/**
 * 上传文档（multipart）表单字段模型，对应 docs/api/api.md {@code POST /api/v1/knowledgeItems/import}。
 */
@Getter
@Setter
public class KbFileImport {

    /** 知识库编码，必填 */
    private String knCode;

    /**
     * 上传到知识库后的文件全路径，以 {@code /} 开头，不包括知识库名称，必填
     */
    private String filePath;

    /** 文件描述，可选 */
    private String fileDescription;

    /** 文件二进制内容（multipart 中的 {@code fileContent} 部分），必填 */
    private MultipartFile multipartFile;
}
