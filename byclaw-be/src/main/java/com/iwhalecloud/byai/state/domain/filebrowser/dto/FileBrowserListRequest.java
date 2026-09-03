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

    /** 排序方式：DIRECTORY_FIRST_NAME_ASC 表示文件夹优先、名称升序。 */
    private String sort;
}
