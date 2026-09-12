package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/** 查询项目空间目录的请求参数。path 为空时查询项目根目录。 */
@Data
public class ProjectSpaceTreeQueryDTO {

    private Long projectId;

    /** 项目空间内的相对路径，使用正斜杠分隔。 */
    private String path;
}
