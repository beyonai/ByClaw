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
     * 普通文件及不解压 ZIP 为文件全路径；解压 ZIP 为目标目录，以 {@code /} 开头，必填
     */
    private String filePath;

    /** 文件描述，可选 */
    private String fileDescription;

    /** 是否解析 Markdown 文件中的 YAML front matter；不传时由 QA 按默认 true 处理。 */
    private Boolean processFrontMatter;

    /** 是否解压 ZIP；不传时由 QA 按默认 true 处理，false 时保存原始 ZIP。 */
    private Boolean extractZip;

    /** JSON object 字符串，作为文件及本次自动创建父目录的基础元数据。 */
    private String metadata;

    /** 文件二进制内容（multipart 中的 {@code fileContent} 部分），必填 */
    private MultipartFile multipartFile;

    /**
     * 是否检查同一知识库内的文件 checksum；默认 false。为 true 且已存在相同 checksum 时跳过导入，并在错误信息中返回已存在文件路径
     */
    private boolean skipIfDuplicate = false;
}
