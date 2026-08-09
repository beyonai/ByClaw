package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 运营任务启动、编辑和执行参数。
 * 编辑阶段只允许修改待开始任务的基础信息；执行阶段不允许篡改需求归属。
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

    /** 用户选择的运营任务模板 ID。 */
    private Long templateId;

    /** 模板详情页补充后的结构化执行配置。 */
    private Map<String, Object> config;

    /** 执行阶段选择的一个或多个数字员工。 */
    private List<Long> agentIds;

    /**
     * 拆分任务确认的承接成员用户 ID；执行时由服务端查询其当前绑定的数字员工。
     * 保留 agentIds 以兼容已发布的旧调用方。
     */
    private List<Long> assigneeIds;
}
