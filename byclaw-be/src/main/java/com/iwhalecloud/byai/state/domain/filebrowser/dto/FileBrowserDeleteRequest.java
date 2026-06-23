package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件删除请求DTO
 *
 * @author liweto
 * @date 2026-06-04
 */
@Getter
@Setter
public class FileBrowserDeleteRequest {

    /** 资源ID */
    private Long resourceId;

    /** 待删除的文件/文件夹相对路径列表 */
    private List<String> paths;
}
