package com.iwhalecloud.byai.state.domain.application.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@Schema(description = "数字员工审批请求")
public class ApprovalRequest {
    @Schema(description = "消息id", required = true)
    private Long messageId;

    @Schema(description = "是否通过", required = true)
    private Boolean approved;

    @Schema(description = "审批备注")
    private String comment;
} 