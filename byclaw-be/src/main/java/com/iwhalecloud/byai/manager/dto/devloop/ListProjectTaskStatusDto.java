package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

/**
 * 项目任务状态字典查询条件。
 */
@Getter
@Setter
public class ListProjectTaskStatusDto {

    /** 项目ID */
    private Long projectId;

    /** 状态维度，空则返回该项目全部维度 */
    private String dimensionName;
}
