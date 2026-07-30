package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

/**
 * 项目空间共享文件重命名请求参数。
 */
@Getter
@Setter
public class ProjectShareFileRenameDto {

    private Long projectId;

    private Long fileId;

    private String fileName;
}
