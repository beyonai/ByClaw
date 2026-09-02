package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

/** 运营需求启动参数，前端确认 AI 拆解结果后一次提交全部任务。 */
@Data
public class OperationRequirementStartDTO {

    /** 待启动的运营需求 ID。 */
    private Long requirementId;

    /** 用户确认后可调整标题、说明和负责人的任务拆解结果。 */
    private List<OperationTaskDTO> tasks;
}
