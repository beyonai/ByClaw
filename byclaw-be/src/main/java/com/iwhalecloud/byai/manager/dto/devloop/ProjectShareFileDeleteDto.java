package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

/**
 * 项目空间共享文件删除请求参数。
 */
@Getter
@Setter
public class ProjectShareFileDeleteDto {

    private Long projectId;

    private Long fileId;
}
