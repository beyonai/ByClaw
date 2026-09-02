package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 项目上下文使用的共享文件只读投影。
 */
@Getter
@Setter
public class ProjectContextSharedFileDto {
    private Long fileId;
    private String fileName;
    private String fileType;
    private Long length;
    private String contentType;
    private Long createBy;
    private Long chatId;
    private String shareLink;
    private Date createTime;
}
