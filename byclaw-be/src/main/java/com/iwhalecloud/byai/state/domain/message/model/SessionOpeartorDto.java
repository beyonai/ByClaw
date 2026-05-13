package com.iwhalecloud.byai.state.domain.message.model;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@Schema(description = "消息操作请求参数")
public class SessionOpeartorDto {
    @Schema(description = "操作类型", example = "praise", allowableValues = {"praise", "tread"})
    private String type;

    @Schema(description = "消息ID", example = "123456", required = true)
    private String messageId;

    @Schema(description = "元数据", example = "{\"key\": \"value\"}")
    private String metadata;

    @Schema(description = "会话ID", example = "789012")
    private Long sessionId;

    @Schema(description = "会话名称", example = "新会话")
    private String sessionName;

    @Schema(description = "会话内容", example = "会话内容")
    private String sessionContent;

    @Schema(description = "反馈内容", example = "{\"feedbackType\": \"Q1\"}")
    private FeedbackDto feedback;
}
