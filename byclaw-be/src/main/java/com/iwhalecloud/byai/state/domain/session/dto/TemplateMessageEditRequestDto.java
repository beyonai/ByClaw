package com.iwhalecloud.byai.state.domain.session.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 编辑模板会话消息内容请求DTO
 *
 * @author smartcloud
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TemplateMessageEditRequestDto implements Serializable {

    /**
     * 会话ID，必传
     */
    @NotNull(message = "会话ID不能为空")
    private Long sessionId;

    /**
     * 消息ID，必传
     */
    @NotNull(message = "消息ID不能为空")
    private Long messageId;

    /**
     * 新的消息内容，必传
     */
    @NotBlank(message = "消息内容不能为空")
    private String messageContent;

    /**
     * 新的消息结构化内容，可选
     * 用于存储消息的结构化数据，如JSON格式
     */
    private String messageStruct;
}
