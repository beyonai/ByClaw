package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;
import org.springframework.web.multipart.MultipartFile;

/**
 * 更新已存在知识库文档的 multipart 请求，对应 {@code POST /api/v1/knowledgeItems/update}。
 */
@Getter
@Setter
public class KbFileUpdate {

    /** 知识库编码，必填。 */
    private String knCode;

    /** 已存在文件的完整路径，以 {@code /} 开头，必填。 */
    private String filePath;

    /** 文件描述；不传时由 QA 保留原描述，传空字符串时清空原描述。 */
    private String fileDescription;

    /** 是否解析 Markdown YAML front matter；不传时由 QA 按默认 true 处理。 */
    private Boolean processFrontMatter;

    /** 更新后的文件二进制内容（multipart 中的 {@code fileContent} 部分），必填。 */
    private MultipartFile multipartFile;
}
