package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

/**
 * 运营任务启动和执行参数。
 * 启动阶段由需求拆解出任务；执行阶段只允许补充数字员工，不允许篡改需求归属。
 */
@Data
public class OperationTaskDTO {

    /** 启动时可为空，执行时必填。 */
    private Long taskId;

    /** 所属运营需求，启动阶段必填。 */
    private Long requirementId;

    /** 所属项目，仅启动阶段使用。 */
    private Long projectId;

    /** 拆解后的任务名称。 */
    private String title;

    /** 拆解后的任务说明。 */
    private String description;

    /** 负责人用户 ID。 */
    private Long assignee;

    /** 完成时间，格式 yyyy-MM-dd HH:mm:ss。 */
    private String dueTime;

    /** 执行阶段选择的一个或多个数字员工。 */
    private List<Long> agentIds;
}
