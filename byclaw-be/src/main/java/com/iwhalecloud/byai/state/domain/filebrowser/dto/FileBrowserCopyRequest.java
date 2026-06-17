package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件复制请求DTO
 *
 * @author liweto
 * @date 2026-06-17
 */
@Getter
@Setter
public class FileBrowserCopyRequest {

    /** 资源ID */
    private Long resourceId;

    /** 源文件/文件夹相对路径 */
    private String sourcePath;

    /** 目标目录相对路径 */
    private String targetDirectory;
}
