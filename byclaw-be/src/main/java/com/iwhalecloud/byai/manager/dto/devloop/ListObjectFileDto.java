package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

/**
 * 项目业务对象关联文件查询条件。
 */
@Getter
@Setter
public class ListObjectFileDto {

    /** 会话ID */
    private Long sessionId;

    /** 项目ID */
    private Long projectId;
}
