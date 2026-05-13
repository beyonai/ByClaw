package com.iwhalecloud.byai.state.domain.chat.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Schema(description = "消息内容对象")
public class ContentVo {
    @Schema(description = "内容类型", example = "消息卡片类型 2005--文章，2004--大纲")
    private String contentType;

    @Schema(description = "消息内容", example = "这是一条测试消息")
    private String content;
}
