package com.iwhalecloud.byai.manager.dto.devloop;

import com.iwhalecloud.byai.manager.entity.devloop.Project;
import lombok.Getter;
import lombok.Setter;

/**
 * 项目列表返回 DTO
 */
@Getter
@Setter
public class ProjectListDto extends Project {

    /** 关联会话数量 */
    private Long sessionCount = 0L;
}
