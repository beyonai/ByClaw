package com.iwhalecloud.byai.state.domain.application.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@Schema(description = "数字员工申请请求")
public class ApplyRequest {
    @Schema(description = "数字员工的id", required = true)
    private Long agentId;
    @Schema(description = "申请原因", required = true)
    private String reason;
    @Schema(description = "审核员id", required = true)
    private Long approveUserId;
} 