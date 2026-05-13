package com.iwhalecloud.byai.manager.dto.operations;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

/**
 * 消息反馈指派请求对象
 * @author zzh
 */
@Data
public class MessageFeedbackAssignRequest {
    /**
     * 数字员工ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{operations.digemployee.resource.id.not.null}")
    private Long resourceId;

    /**
     * 对应消息的relId
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{operations.digemployee.relId.not.null}")
    private Long relId;

    /**
     * 对应消息的回复消息ID(大模型回答的resMsgId)
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{operations.digemployee.resMsgId.not.null}")
    private Long resMsgId;

    /**
     * 消息提问ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{operations.digemployee.askMsgId.not.null}")
    private Long askMsgId;

    /**
     * 消息的反馈类型 ANS_INACCURATE-答案不准确、 WRONG_PERSON-找错人、 FEED_OTHER-其他
     */
    private String feedbackLabel;

    /**
     * 消息的反馈内容 ，当feedbackLabel为FEED_OTHER 才会有
     */
    private String feedbackContent;

    /**
     * 指派人 id
     */
    @NotEmpty(message = "{operations.digemployee.assigner.ids.not.null}")
    private List<Long> assignerIds;

    /**
     * 指派理由
     */
    @NotBlank(message = "{operations.digemployee.assigner.assignReason.not.null}")
    private String assignReason;


}
