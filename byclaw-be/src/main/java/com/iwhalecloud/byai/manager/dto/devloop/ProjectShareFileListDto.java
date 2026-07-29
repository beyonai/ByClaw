package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

/**
 * 项目空间共享文件列表 DTO。
 */
@Getter
@Setter
public class ProjectShareFileListDto {

    private Long fileId;

    private String fileName;

    private String fileUrl;

    private Long projectId;

    private String shareLink;
}
