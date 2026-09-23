package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

/** 项目云盘中的逻辑文件引用，不包含文件二进制。 */
@Data
public class GroupChatTaskFile {
    @JsonSerialize(using = ToStringSerializer.class)
    private Long fileId;
    @NotBlank
    private String fileName;
    @NotBlank
    private String filePath;
    /** 发布时由服务端填充的项目云盘知识库 ID，不信任请求中的值。 */
    private String cloudResourceId;
}
