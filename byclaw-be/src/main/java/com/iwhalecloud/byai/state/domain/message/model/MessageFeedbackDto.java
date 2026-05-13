package com.iwhalecloud.byai.state.domain.message.model;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
@Schema(description = "消息操作请求参数")
public class MessageFeedbackDto {
    @Schema(description = "反馈类型", example = "praise", allowableValues = {
        "praise", "tread"
    })
    @NotBlank(message = "反馈类型不能为空")
    private String type;

    @Schema(description = "消息ID", example = "123456", required = true)
    @NotNull(message = "消息ID不能为空")
    private Long messageId;

    @Schema(description = "反馈标签", example = "Q1", required = true, allowableValues = {
        "ANS_INACCURATE", "WRONG_PERSON", "FEED_OTHER"
    })
    private String feedbackLabel;

    @Schema(description = "反馈内容(其他)", example = "不太理解")
    private String feedbackContent;
}
