package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 保存文件到项目空间请求 DTO。
 */
@Data
public class ProjectShareFileSaveDto {

    /** 项目ID */
    private Long projectId;

    /** 会话ID */
    private Long sessionId;

    /** 源文件路径 */
    private String filePath;

    /** 文件名称 */
    private String fileName;
}
