package com.iwhalecloud.byai.state.domain.callback.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;

import jakarta.validation.constraints.NotBlank;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 回调请求DTO
 *
 * @author system
 * @date 2025-01-27
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "回调请求参数")
public class CallbackRequest implements Serializable {
    private static final long serialVersionUID = 1L;

    @NotBlank(message = "会话ID不能为空")
    @Schema(description = "会话ID", example = "session_123456")
    private String chatId;

    //@NotBlank(message = "任务ID不能为空")
    @Schema(description = "任务ID", example = "task_123456")
    private String taskId;

    @NotBlank(message = "消息ID不能为空")
    @Schema(description = "消息ID", example = "msg_123456")
    private String messageId;

    @NotBlank(message = "用户ID不能为空")
    @Schema(description = "用户ID", example = "user_123456")
    private String userId;

    //@NotBlank(message = "项目ID不能为空")
    @Schema(description = "项目ID", example = "project_123456")
    private String projectId;

    //@NotBlank(message = "文件tags")
    @Schema(description = "文件tags", example = "tag_123456")
    private String tags;

    @Schema(description = "步骤id", example = "step_123456")
    private String stepId;

    @Schema(description = "时间戳", example = "1346554546454")
    private Long timestamp;

    @NotBlank(message = "签名不能为空")
    @Schema(description = "请求签名", example = "ABC123DEF456")
    private String signature;

}