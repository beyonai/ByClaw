package com.iwhalecloud.byai.state.domain.chat.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

/**
 * @author zht
 * @version 1.0
 * @date 2025/7/1
 */
@Data
@Schema(description = "消息表单提交")
public class MessageFormSubmitDto {
    @Schema(description = "消息id", example = "123")
    private Long messageId;
    @Schema(description = "输入、输出", example = "1")
    private String inOutType;
    @Schema(description = "插件id", example = "1")
    private String pluginAppId;
    @Schema(description = "工具id", example = "1")
    private String pluginMachineId;
    private String versionType;
    @Schema(description = "插件内容", example = "1")
    private List<MessageFormContentDto> pluginMachineFields;
    @Schema(description = "是否企业员工", example = "1")
    private Boolean humanTool;
}
