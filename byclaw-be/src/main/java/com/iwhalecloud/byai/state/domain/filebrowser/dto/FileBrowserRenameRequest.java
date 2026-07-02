package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件重命名请求DTO
 *
 * @author liweto
 * @date 2026-06-04
 */
@Getter
@Setter
public class FileBrowserRenameRequest {

    /** 资源ID */
    private Long resourceId;

    /** 源文件相对路径 */
    private String sourcePath;

    /** 新名称 */
    private String newName;
}
