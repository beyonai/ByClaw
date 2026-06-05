package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件搜索请求DTO
 *
 * @author liweto
 * @date 2026-06-04
 */
@Getter
@Setter
public class FileBrowserSearchRequest {

    /** 资源ID */
    private Long resourceId;

    /** 搜索起始目录相对路径 */
    private String path;

    /** 搜索关键词 */
    private String keyword;
}
