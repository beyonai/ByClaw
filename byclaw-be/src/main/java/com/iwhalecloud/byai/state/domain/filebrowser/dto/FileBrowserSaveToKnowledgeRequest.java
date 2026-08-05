package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件模块保存到知识库请求。
 */
@Getter
@Setter
public class FileBrowserSaveToKnowledgeRequest {

    /** 文件模块所属数字员工资源 ID。 */
    private Long resourceId;

    /** 源文件或文件夹路径。 */
    private String sourcePath;

    /** 源路径是否为文件夹。 */
    private Boolean sourceDir;

    /** 目标知识库资源 ID。 */
    private Long targetResourceId;

    /** 目标知识库目录路径，根目录为 /。 */
    private String targetDirectoryPath;

    /** 是否解析 Markdown YAML Front Matter。 */
    private Boolean processFrontMatter;

    /** 同路径同名文件存在时是否覆盖。 */
    private Boolean overwrite;
}
