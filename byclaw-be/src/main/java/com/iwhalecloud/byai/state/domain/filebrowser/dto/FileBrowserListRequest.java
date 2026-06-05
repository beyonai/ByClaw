package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件列表/创建文件夹请求DTO
 *
 * @author liweto
 * @date 2026-06-04
 */
@Getter
@Setter
public class FileBrowserListRequest {

    /** 资源ID */
    private Long resourceId;

    /** 目录相对路径 */
    private String path;
}
