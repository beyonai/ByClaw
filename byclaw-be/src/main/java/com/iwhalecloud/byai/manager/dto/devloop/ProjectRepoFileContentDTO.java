package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/** 远程仓库文件内容。 */
@Data
public class ProjectRepoFileContentDTO {

    private String name;
    private String path;
    private String branch;
    private String sha;
    private Long size;
    /** 文本文件为 UTF-8 内容；二进制文件为空。 */
    private String content;
    /** 二进制文件的 Base64 内容；文本文件为空。 */
    private String base64Content;
    private Boolean binary;
    private String url;
    private String downloadUrl;
}
