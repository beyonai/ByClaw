package com.iwhalecloud.byai.state.domain.chat.dto;

import java.util.Map;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@Schema(description = "外部消息对象")
public class ExternalMessageVo {
    @Schema(description = "会话ID", example = "123456")
    private Long sessionId;

    @Schema(description = "消息内容")
    private ContentVo content;

    @Schema(description = "智能体ID", example = "123")
    private String agentId;

    @Schema(description = "消息ID", example = "789012")
    private Long messageId;

    @Schema(description = "扩展参数", example = "{\"key\": \"value\"}")
    private Map<String, Object> extParam;
}
