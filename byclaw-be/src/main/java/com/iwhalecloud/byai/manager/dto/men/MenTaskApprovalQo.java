package com.iwhalecloud.byai.manager.dto.men;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

/**
 * 待办任务审批请求对象
 */
@Data
@Schema(description = "待办任务审批请求对象")
public class MenTaskApprovalQo {
    
    /** 任务ID */
    @Schema(description = "任务ID", required = true)
    @NotNull(message = "{mentask.approval.taskid.notnull}")
    private Long taskId;
    
    /** 审批状态：PASS-通过，REJECT-不通过 */
    @Schema(description = "审批状态：PASS-通过，REJECT-不通过", required = true)
    @Pattern(regexp = "^(PASS|REJECT)$", message = "{mentask.approval.status.invalid}")
    private String approvalStatus;
    
    /** 审批内容/意见 */
    @Schema(description = "审批内容/意见")
    private String approvalContent;
}