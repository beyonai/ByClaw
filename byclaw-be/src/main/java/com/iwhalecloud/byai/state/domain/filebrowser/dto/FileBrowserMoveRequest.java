package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件移动请求DTO
 *
 * @author liweto
 * @date 2026-06-04
 */
@Getter
@Setter
public class FileBrowserMoveRequest {

    /** 资源ID */
    private Long resourceId;

    /** 源文件/文件夹相对路径列表 */
    private List<String> sourcePaths;

    /** 目标目录相对路径 */
    private String targetDirectory;
}
