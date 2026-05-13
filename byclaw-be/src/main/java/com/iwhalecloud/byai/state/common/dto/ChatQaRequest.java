package com.iwhalecloud.byai.state.common.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * 知识问答请求DTO
 */
@Data
@Schema(description = "知识问答请求参数")
public class ChatQaRequest {

    @Schema(description = "语言，目前支持中文", example = "zh-CN")
    private String language = "zh-CN";

    @NotBlank(message = "{chatqarequest.chatcontent.notempty}")
    @Schema(description = "问题内容", required = true)
    private String chatContent;

    @Schema(description = "知识库ID列表")
    private List<Long> datasetIdList;

    @Schema(description = "文档ID列表")
    private List<Long> docIdList;
}