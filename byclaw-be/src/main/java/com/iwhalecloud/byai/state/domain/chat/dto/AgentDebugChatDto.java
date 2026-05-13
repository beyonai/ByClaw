package com.iwhalecloud.byai.state.domain.chat.dto;


import com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;


@EqualsAndHashCode(callSuper = true)
@Data
@Schema(description = "数字员工调试请求参数")
public class AgentDebugChatDto extends AssistantChatDto {

    @Schema(description = "数字员工信息", example = "123456")
    private AgentResourceChatInfoDto agent;

    //@Schema(description = "数字员工ID", example = "123456")
    //private String agentId;

    //@Schema(description = "用户输入内容", example = "你好")
    //private String chatContent;

    //@Schema(description = "用户上传文件", example = "[]")
    //private List<MessageFileDto> files;
} 