package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/** 创建项目空间目录。path 为项目根目录下的相对目录路径。 */
@Data
public class ProjectSpaceFolderCreateDTO {

    private Long projectId;

    private String path;
}
