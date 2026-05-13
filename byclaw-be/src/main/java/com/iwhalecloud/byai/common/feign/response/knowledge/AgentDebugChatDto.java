package com.iwhalecloud.byai.common.feign.response.knowledge;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.ArrayList;
import lombok.Data;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Data
@Schema(description = "数字员工调试请求参数")
public class AgentDebugChatDto {

    // @Schema(description = "数字员工信息", example = "123456")
    // private AgentResourceChatInfoDto agent;

    @Schema(description = "会话ID", example = "123456")
    private Long sessionId;

    @Schema(description = "数字员工ID", example = "123456")
    private Long agentId;

    @Schema(description = "用户输入内容", example = "你好")
    private String chatContent;

    @Schema(description = "用户上传文件", example = "[]")
    private List<MessageFileDto> files;

    /**
     * 资源列表
     */
    @Schema(description = "资源列表")
    private List<ResourceInfoDto> resourceList = new ArrayList<>();

    /**
     * 会话id（改一下）
     */
    @Schema(description = "扩展参数(问数,慧笔，鲸灵专用)", example = "{\"key\": \"value\"}")
    private Map<String, Object> extParams = new HashMap<>();

}