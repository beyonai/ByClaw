package com.iwhalecloud.byai.manager.dto.position;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

/**
 * 数字员工岗位审批请求DTO
 */
@Data
public class ResourcePositionApprovalDTO {

    /**
     * 岗位ID
     */
    @NotNull(message = "position.positionid.notnull")
    private Long positionId;

    /**
     * 资源ID
     */
    @NotNull(message = "resource.resourceid.notnull")
    private Long resourceId;

    /**
     * 任务ID
     */
    @NotNull(message = "{mentask.approval.taskid.notnull}")
    private Long taskId;

    /**
     * 审批状态：PASS-通过，REJECT-不通过
     */
    @Pattern(regexp = "^(PASS|REJECT)$", message = "{mentask.approval.status.invalid}")
    private String approvalStatus;

    /**
     * 审批内容/意见
     */
    @Schema(description = "审批内容/意见")
    private String approvalContent;

}