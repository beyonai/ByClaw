package com.iwhalecloud.byai.manager.dto.system;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 系统反馈状态流转参数。
 */
@Getter
@Setter
public class SystemFeedbackStatusUpdateDTO {

    /**
     * 反馈ID。
     */
    @NotNull
    private Long feedbackId;

    /**
     * 目标状态。
     */
    @NotBlank
    private String status;

    /**
     * 本次处理备注。
     */
    @Size(max = 1000)
    private String processComment;
}
