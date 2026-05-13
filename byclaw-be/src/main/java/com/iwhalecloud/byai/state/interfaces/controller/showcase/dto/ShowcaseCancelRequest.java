package com.iwhalecloud.byai.state.interfaces.controller.showcase.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 成果空间取消收藏请求
 */
@Getter
@Setter
public class ShowcaseCancelRequest {

    /**
     * 会话ID
     */
    @NotNull(message = "会话ID不能为空")
    private Long sessionId;

    /**
     * 成果类型
     */
    @NotBlank(message = "成果类型不能为空")
    @Size(max = 64, message = "成果类型长度不能超过64字符")
    private String type;

    /**
     * 文件编码
     */
    @Size(max = 128, message = "文件编码长度不能超过128字符")
    private String fileCode;

    /**
     * 消息ID
     */
    private Long messageId;
}



