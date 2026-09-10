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
}
